Page({
  data: {
    dateList: [],
    courtList: [],
    timeList: [],
    courtStatus: {}, // { courtId: { time: {status, text} } }
    totalPrice: 0,
    selectedCount: 0,
    court_count: 13,
    currentDate: '',
    phoneNumber: '', // Add phone number field
    needRefresh: false, // Add flag to control refresh
    eventChannel: null, // Add event channel
    lastUpdateTime: 0, // 记录最后更新时间，用于防抖
    showVenueModal: false, // 控制场馆分布弹窗显示
    isProcessingOrder: false, // 是否正在处理订单（创建订单到付款完成期间）
    showPaymentModal: false, // 控制支付提醒弹窗显示
    paymentModalData: null, // 保存弹窗确认后的回调数据
    venueImages: [
     'cloud://cloud1-6gebob4m4ba8f3de.636c-cloud1-6gebob4m4ba8f3de-1357716382/mp_asset/微信图片_2025-08-10_213705_306.jpg',
    'cloud://cloud1-6gebob4m4ba8f3de.636c-cloud1-6gebob4m4ba8f3de-1357716382/mp_asset/微信图片_2025-08-10_213716_234.jpg',
    'cloud://cloud1-6gebob4m4ba8f3de.636c-cloud1-6gebob4m4ba8f3de-1357716382/mp_asset/微信图片_20250810213727_62.jpg',
    'cloud://cloud1-6gebob4m4ba8f3de.636c-cloud1-6gebob4m4ba8f3de-1357716382/mp_asset/微信图片_20250810213734_65.jpg',
    ], // 场馆分布图片数组
    currentCampus: '麓坊校区', // 当前选择的校区
    showCampusPicker: false, // 控制校区选择器显示
    campusList: [
      { name: '麓坊校区', latitude: 30.461094427278926, longitude: 104.05406090412829, address: '麓坊街93号' },
      { name: '桐梓林校区', latitude: 30.61597, longitude: 104.07435, address: '桐梓林路123号' },
      { name: '雅居乐校区', latitude: 30.48023, longitude: 104.1375, address: '雅居乐城内（待更新）' },
    ], // 校区列表
   
  },

  onLoad: function (options) {
    // 初始化时读取手机号
    const phoneNumber = wx.getStorageSync('phoneNumber');
    this.setData({
      phoneNumber: phoneNumber
    });

    // 从全局状态中获取校区信息，如果没有则使用默认值
    const app = getApp();
    const campus = app.globalData.selectedCampus || '麓坊校区';
    this.setData({
      currentCampus: campus
    });

    this.initDateList();
    this.initTimeList();
    this.initCourtListByCloud();
    // 默认加载时调用 onDateTabChange，模拟点击第一个日期
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const fullDate = `${yyyy}${mm}${dd}`;
    this.onDateTabChange({ currentTarget: { dataset: { index: 0, fullDate } } });


    const eventChannel = app.globalData.eventBus;
    if (eventChannel) {
      this.setData({ eventChannel });
      // Listen for refresh event
      eventChannel.on('refreshBooking', () => {
        this.refreshPage();
      });
    }

    // Add global event bus listener
    app.globalData.eventBus.on('refreshBookingPage', () => {
      this.refreshPage();
    });

    // 启动自动刷新定时器（每30秒刷新一次）
    this.startAutoRefresh();
  },

  // 分享给朋友
  onShareAppMessage() {
    return {
      title: `乐动网球-${this.data.currentCampus}-场地预约`,
      desc: `${this.data.currentCampus}所有场地都开放预约！`,
      path: '/pages/booking/booking'
    }
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: `乐动网球-${this.data.currentCampus}-场地预约`,
      query: `${this.data.currentCampus}所有场地都开放预约！`
    }
  },

  onUnload: function() {
    // Clean up event bus listener
    const app = getApp();
    app.globalData.eventBus.off('refreshBookingPage');
    app.globalData.eventBus.off('refreshBooking');
    
    // 清除自动刷新定时器
    this.stopAutoRefresh();
    
    // 重置处理订单状态
    this.setData({ isProcessingOrder: false });
  },

  openLocation: function() {
    // 根据当前校区获取对应的位置信息
    const currentCampusInfo = this.data.campusList.find(campus => campus.name === this.data.currentCampus);
    if (currentCampusInfo) {
      wx.openLocation({
        latitude: currentCampusInfo.latitude,
        longitude: currentCampusInfo.longitude,
        name: `乐动网球·${this.data.currentCampus}`,
        address: currentCampusInfo.address,
        scale: 18
      });
    } else {
      // 如果找不到校区信息，使用默认的麓坊校区
      wx.openLocation({
        latitude: 30.461094427278926,
        longitude: 104.05406090412829,
        name: `乐动网球·${this.data.currentCampus}`,
        address: '麓坊街93号',
        scale: 18
      });
    }
  },
 
  // Add refresh method
  refreshPage: function() {
    console.log('Refreshing booking page...');
    const phoneNumber = wx.getStorageSync('phoneNumber');
    this.setData({ 
      phoneNumber: phoneNumber 
    });
    this.initCourtStatusByCloud(this.data.currentDate);
  },

  onShow: function() {
    console.log('----onshow---')
    // Read phone number from storage every time page is shown
    const phoneNumber = wx.getStorageSync('phoneNumber');
    this.setData({ 
      phoneNumber: phoneNumber 
    });
    
    // 检查是否需要切换校区
    const app = getApp();
    if (app.globalData.needSwitchCampus && app.globalData.selectedCampus) {
      const newCampus = app.globalData.selectedCampus;
      console.log('检测到校区切换:', this.data.currentCampus, '->', newCampus);
      
      this.setData({
        currentCampus: newCampus
      });
      
      // 清空选中状态并重新加载数据
      this.clearSelectedStatus();
      this.initCourtListByCloud();
      
      // 确保有有效的currentDate
      if (this.data.currentDate) {
        this.initCourtStatusByCloud(this.data.currentDate);
      }
      
      // 清除标记和全局状态中的校区信息
      app.globalData.needSwitchCampus = false;
      app.globalData.selectedCampus = null;
      console.log('校区切换完成，已清除标记和全局状态');
    }
    
    // Only refresh if needed
    if (this.data.needRefresh) {
      this.initCourtStatusByCloud(this.data.currentDate);
      this.setData({ needRefresh: false });
    }
  },

  initDateList: function () {
    const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dateList = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const weekStr = i === 0 ? '今天' : weekMap[d.getDay()];
      dateList.push({
        dateStr: `${month}.${day}`,
        weekStr,
        selected: i === 0
      });
    }
    this.setData({ dateList });
    console.log('日期列表:', dateList);
  },

  initTimeList: function () {
    const timeList = [];
    // 根据校区设置不同的时间段：麓坊、雅居乐7-24点，桐梓林9-22点
    const campusTimeConfig = {
      '麓坊校区': { start: 7, end: 24 },
      '雅居乐校区': { start: 7, end: 24 },
      '桐梓林校区': { start: 9, end: 22 }
    };
    const { start: startHour, end: endHour } = campusTimeConfig[this.data.currentCampus] || campusTimeConfig['麓坊校区'];
    
    for (let h = startHour; h < endHour; h++) {
      timeList.push({ time: `${h < 10 ? '0' + h : h}:00` });
      timeList.push({ time: `${h < 10 ? '0' + h : h}:30` });
    }
    // timeList.push({ time: '24:00' });
    this.setData({ timeList });
  },

  initCourtStatusByCloud: function (date) {
    this.setData({ courtStatus: {} });
    wx.cloud.callFunction({
      name: 'get_court_order',
      data: {
        date: date,
        campus: this.data.currentCampus
      },
      success: res => {
        if (res.result && res.result.success) {
          // 获取管理员列表
          const app = getApp();
          const managerList = app.globalData.managerList || [];
          
          // 先获取所有场地号
          const courtNumbers = [...new Set(res.result.data.map(item => ({courtNumber:item.courtNumber, price:item.price})))];
          // 获取所有时间点
          const timeList = this.data.timeList.map(t => t.time);
          // 构造结构，courtStatus为对象，key为courtNumber，value为times数组
          const courtStatus = {};
          courtNumbers.forEach((order) => {
            const courtData = res.result.data.filter(item => item.courtNumber === order.courtNumber);
            const times = timeList.map(time => {
              const found = courtData.find(item => item.start_time === time);
              if (found) {
                // 判断订场人是否为管理员
                const isBookedByManager = found.booked_by && managerList.includes(found.booked_by);
                
                return {
                  time: found.start_time,
                  status: found.status === 'free' ? 'available' : found.status,
                  text: found.status === 'free' ? `${found.price}` : found.status === 'locked' ? '已锁定' : '已预定',
                  courtNumber: order.courtNumber,
                  booked_by: found.booked_by || '',
                  isBookedByManager: isBookedByManager
                }
              } else {
                return {
                  time,
                  status: 'available',
                  text: order.price,
                  courtNumber: order.courtNumber,
                  booked_by: '',
                  isBookedByManager: false
                }
              }
            });
            courtStatus[order.courtNumber] = times;
          });

          this.setData({ courtStatus });
        } else {
          wx.showToast({ title: '获取场地状态失败', icon: 'none' });
          console.error('云函数返回失败:', res.result);
        }
      },
      fail: err => {
        wx.showToast({ title: '云函数调用失败', icon: 'none' });
        console.error('云函数调用失败:', err);
      }
    })
  },



  initCourtListByCloud: function () {
    wx.cloud.callFunction({
      name: 'get_court_list_by_section',
      data: {
        campus: this.data.currentCampus
      },
      success: res => {
        if (res.result && res.result.success) {
          this.setData({ courtList: res.result.data });
          console.log('云函数返回场地列表:', res.result.data);
        } else {
          wx.showToast({ title: '获取场地失败', icon: 'none' });
          console.error('云函数返回失败:', res.result);
        }
      },
      fail: err => {
        wx.showToast({ title: '云函数调用失败', icon: 'none' });
        console.error('云函数调用失败:', err);
      }
    });
  },

  onDateTabChange: function (e) {
    const idx = e.currentTarget.dataset.index;
    const dateList = this.data.dateList.map((item, i) => ({ ...item, selected: i === idx }));
    this.setData({ dateList });

    // 打印被点击的日期和索引
    console.log('点击的日期索引:', idx);
    console.log('点击的日期对象:', this.data.dateList[idx]);

    // 计算完整的年月日
    const today = new Date();
    const clickedDate = new Date(today.getTime() + idx * 24 * 60 * 60 * 1000);
    const yyyy = clickedDate.getFullYear();
    const mm = String(clickedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(clickedDate.getDate()).padStart(2, '0');
    const fullDate = `${yyyy}${mm}${dd}`;
    console.log('点击的完整日期:', fullDate);
    // 这里可以根据日期切换刷新 courtStatus
    this.setData({ currentDate: fullDate });
    this.initCourtStatusByCloud(fullDate);
  },

  getTimesByCourtNumber: function (courtNumber) {
    const found = this.data.courtStatus.find(item => item.courtNumber == courtNumber);
    return found ? found.times : [];
  },

  onCourtTimeTap: function (e) {
    // 如果正在处理订单，不允许选择场地
    if (this.data.isProcessingOrder) {
      // wx.showToast({
      //   title: '正在处理订单，请稍候',
      //   icon: 'none',
      //   duration: 2000
      // });
      return;
    }

    const { courtnumber, time } = e.currentTarget.dataset;
    const courtStatusAll = this.data.courtStatus;
    const times = courtStatusAll[courtnumber] || [];
    const item = times.find(i => i.time === time);
    const phoneNumber = this.data.phoneNumber;

    // Get global managerList and specialManagerList and check if user is manager or special manager
    const app = getApp();
    const managerList = app.globalData.managerList;
    const specialManagerList = app.globalData.specialManagerList;
    const isManager = managerList && managerList.includes(phoneNumber);
    const isSpecialManager = specialManagerList && specialManagerList.includes(phoneNumber);

    if (item.booked_by && item.booked_by !== phoneNumber) {
      if (isManager) {
        wx.showModal({
          title: '已被预订',
          content: `预订人电话：${item.booked_by}`,
          showCancel: false
        });
      }
      return;
    }

    // 检查日期和时间是否在当前时间之后
    const now = new Date();
    const selectedDate = new Date(this.data.currentDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
    const [selectedHour, selectedMinute] = time.split(':').map(Number);
    selectedDate.setHours(selectedHour, selectedMinute, 0, 0);

    if (selectedDate <= now) {
      wx.showToast({
        title: '无法预订过去的时间',
        icon: 'none'
      });
      return;
    }

    // // 检查用户权限（只有管理员可以预订）
    // if (!isManager) {
    //   wx.showToast({
    //     title: '订场暂未开放，尽请期待',
    //     icon: 'none'
    //   });
    //   return;
    // }

    // 检查日期是否超过限制（特殊管理员14天，管理员7天，普通用户只能预约今天和明天）
    if (isSpecialManager) {
      // 特殊管理员可以预约14天内
      const maxDays = 14;
      const maxDaysFromNow = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);
      
      if (selectedDate > maxDaysFromNow) {
        wx.showToast({
          title: `只能预约${maxDays}天内的场地`,
          icon: 'none'
        });
        return;
      }
    } else if (isManager) {
      // 管理员可以预约7天内
      const maxDays = 7;
      const maxDaysFromNow = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);
      
      if (selectedDate > maxDaysFromNow) {
        wx.showToast({
          title: `只能预约${maxDays}天内的场地`,
          icon: 'none'
        });
        return;
      }
    } else {
      // 普通用户只能预约今天和明天
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      const dayAfterTomorrow = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
      
      const selectedDateOnly = new Date(selectedDate);
      selectedDateOnly.setHours(0, 0, 0, 0);
      if (selectedDateOnly >= dayAfterTomorrow) {
        wx.showToast({
          title: '只能预约今明两天场地',
          icon: 'none'
        });
        return;
      }
    }

    let courtStatus = this.data.courtStatus;
    const idx = times.findIndex(item => item.time === time);
    if (idx !== -1) {
      const item = times[idx];
      // if (item.status === 'booked' || item.status === 'locked') return; // 已预定不可选
      if (item.status === 'booked' || item.status === 'locked') {
        this.setData({ needRefresh: true }); // Set flag before navigation
        // 构造court_id用于定位订单
        const court_id = `${courtnumber}_${this.data.currentDate}_${time}`;
        wx.navigateTo({
          url: `/pages/myOrder/orderlist?targetCourtId=${encodeURIComponent(court_id)}`
        });
        return
      };
      //   // 切换选中状态onOrderSubmit
      item.selected = !item.selected;
      courtStatus = { ...courtStatus, [courtnumber]: [...times] };
      this.setData({ courtStatus });
      this.updateSelectedSummary();
    }
  },

  updateSelectedSummary: function () {
    let selectedCount = 0;
    let totalPrice = 0;
    const courtStatus = this.data.courtStatus;
    Object.values(courtStatus).forEach(times => {
      times.forEach(item => {
        if (item.selected) {
          selectedCount += 0.5;
          const price = parseFloat(item.text.replace(/[^\d.]/g, ''));
          if (!isNaN(price)) totalPrice += price;
        }
      });
    });
    // Round totalPrice to 2 decimal places
    totalPrice = Math.round(totalPrice * 100) / 100;
    this.setData({ selectedCount, totalPrice });
  },

  clearSelectedStatus: function () {
    // 清空所有选中状态
    const courtStatus = this.data.courtStatus;
    Object.keys(courtStatus).forEach(courtNumber => {
      courtStatus[courtNumber].forEach(item => {
        item.selected = false;
      });
    });
    this.setData({ 
      courtStatus,
      selectedCount: 0,
      totalPrice: 0
    });
  },

  startAutoRefresh: function () {
    // 防抖：如果已经有定时器在运行，先停止
    this.stopAutoRefresh();
    
    // 启动自动刷新定时器
    this.autoRefreshTimer = setInterval(() => {
      if (this.data.currentDate) {
        console.log('自动刷新场地状态...');
        this.updateCourtStatusIncrementally(this.data.currentDate);
      }
    }, 50000); // 每30秒刷新一次，但只更新状态，不重新渲染
  },
  

  stopAutoRefresh: function () {
    // 停止自动刷新定时器
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  },

  updateCourtStatusIncrementally: function (date) {
    // 防抖：如果距离上次更新不足5秒，则跳过
    const now = Date.now();
    if (now - this.data.lastUpdateTime < 5000) {
      return;
    }
    
    // 增量更新场地状态，不重新渲染整个页面
    wx.cloud.callFunction({
      name: 'get_court_order',
      data: {
        date: date,
        campus: this.data.currentCampus
      },
      success: res => {
        if (res.result && res.result.success) {
          // 获取管理员列表
          const app = getApp();
          const managerList = app.globalData.managerList || [];
          
          // 更新最后更新时间
          this.setData({ lastUpdateTime: now });
          
          // 先获取所有场地号
          const courtNumbers = [...new Set(res.result.data.map(item => ({courtNumber:item.courtNumber, price:item.price})))];
          // 获取所有时间点
          const timeList = this.data.timeList.map(t => t.time);
          
          // 构造新的状态数据
          const newCourtStatus = {};
          courtNumbers.forEach((order) => {
            const courtData = res.result.data.filter(item => item.courtNumber === order.courtNumber);
            const times = timeList.map(time => {
              const found = courtData.find(item => item.start_time === time);
              if (found) {
                // 判断订场人是否为管理员
                const isBookedByManager = found.booked_by && managerList.includes(found.booked_by);
                
                return {
                  time: found.start_time,
                  status: found.status === 'free' ? 'available' : found.status,
                  text: found.status === 'free' ? `${found.price}` : found.status === 'locked' ? '已锁定' : '已预定',
                  courtNumber: order.courtNumber,
                  booked_by: found.booked_by || '',
                  isBookedByManager: isBookedByManager
                }
              } else {
                return {
                  time,
                  status: 'available',
                  text: order.price,
                  courtNumber: order.courtNumber,
                  booked_by: '',
                  isBookedByManager: false
                }
              }
            });
            newCourtStatus[order.courtNumber] = times;
          });

          // 智能更新：只更新状态发生变化的部分
          this.updateCourtStatusSmartly(newCourtStatus);
        }
      },
      fail: err => {
        console.error('增量更新失败:', err);
      }
    });
  },

  updateCourtStatusSmartly: function (newCourtStatus) {
    const currentCourtStatus = this.data.courtStatus;
    let hasChanges = false;
    let hasImportantChanges = false; // 重要变化（如锁定状态变化）
    const updatedCourtStatus = { ...currentCourtStatus };

    // 遍历新状态，只更新发生变化的部分
    Object.keys(newCourtStatus).forEach(courtNumber => {
      const newTimes = newCourtStatus[courtNumber];
      const currentTimes = currentCourtStatus[courtNumber];
      
      if (!currentTimes) {
        // 新场地，直接添加
        updatedCourtStatus[courtNumber] = newTimes;
        hasChanges = true;
        return;
      }

      // 检查时间点状态是否有变化
      const updatedTimes = [];
      let courtHasChanges = false;
      
      newTimes.forEach((newTime, index) => {
        const currentTime = currentTimes[index];
        if (!currentTime || 
            currentTime.status !== newTime.status || 
            currentTime.text !== newTime.text ||
            currentTime.booked_by !== newTime.booked_by ||
            currentTime.isBookedByManager !== newTime.isBookedByManager) {
          // 状态发生变化，但保持选中状态
          updatedTimes.push({
            ...newTime,
            selected: currentTime ? currentTime.selected : false
          });
          courtHasChanges = true;
          
          // 检查是否是重要变化（状态从可用变为锁定或预订）
          if (currentTime && 
              (currentTime.status === 'available' || currentTime.status === 'free') && 
              (newTime.status === 'locked' || newTime.status === 'booked')) {
            hasImportantChanges = true;
          }
        } else {
          // 状态未变化，保持原有状态
          updatedTimes.push(currentTime);
        }
      });

      if (courtHasChanges) {
        updatedCourtStatus[courtNumber] = updatedTimes;
        hasChanges = true;
      }
    });

    // 只有在有变化时才更新数据
    if (hasChanges) {
      console.log('检测到场地状态变化，更新中...');
      this.setData({ courtStatus: updatedCourtStatus });
      this.updateSelectedSummary(); // 重新计算选中状态
      
      // 如果有重要变化，显示轻微提示
      if (hasImportantChanges) {
        wx.showToast({
          title: '场地状态已更新',
          icon: 'none',
          duration: 1500
        });
      }
    }
  },

  onOrderSubmit: function () {
    // 设置正在处理订单状态
    this.setData({ isProcessingOrder: true });

    // Get global managerList and specialManagerList
    const app = getApp();
    const managerList = app.globalData.managerList;
    const specialManagerList = app.globalData.specialManagerList;
    console.log('Global managerList:', managerList);
    console.log('Global specialManagerList:', specialManagerList);

    // Get user's phone number and check if in managerList or specialManagerList
    const userPhone = this.data.phoneNumber;
    const isManager = managerList && managerList.includes(userPhone);
    const isSpecialManager = specialManagerList && specialManagerList.includes(userPhone);
    console.log('User phone:', userPhone);
    console.log('Is user a manager:', isManager);
    console.log('Is user a special manager:', isSpecialManager);

    // 收集所有选中的项
    const selectedList = [];
    let total_fee = 0;
    const courtStatus = this.data.courtStatus;
    const campus = this.data.currentCampus;
    const date = this.data.currentDate;
 
    Object.keys(courtStatus).forEach(courtNumber => {
      courtStatus[courtNumber].forEach(item => {
        if (item.selected) {
          // 计算结束时间（+30分钟）
          let [h, m] = item.time.split(':').map(Number);
          m += 30;
          if (m >= 60) { h += 1; m -= 60; }
          const end_time = `${h < 10 ? '0' + h : h}:${m === 0 ? '00' : '30'}`;
          // 价格
          const price = parseFloat(item.text.replace(/[^\d.]/g, '')) || 0;
          total_fee += price;
          // 构造court_id: 场地号+日期+开始时间
          const court_id = `${courtNumber}_${date}_${item.time}`;
          selectedList.push({
            court_id,
            campus: campus,
            courtNumber: courtNumber,
            date: date,
            start_time: item.time,
            end_time: end_time,
            status: 'locked',
            price: price,
            booked_by: this.data.phoneNumber,
            is_verified: false
          });
        }
      });
    });
    // Round total_fee to 2 decimal places
    total_fee = Math.round(total_fee * 100) / 100;
    console.log('已选中的场地时间段:', selectedList);

    if (selectedList.length === 0) {
      wx.showToast({ title: '请选择时间段', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中...' });
    // 批量调用云函数
    wx.cloud.callFunction({
      name: 'update_court_order',
      data: {
        data: selectedList
      },
      success: res => {
        wx.hideLoading();
        
        // 检查是否有冲突错误
        const hasConflict = res.result.results.some(result => 
          result.type === 'conflict' || 
          (result.success === false && result.error && 
           (result.error.includes('冲突') || result.error.includes('锁定')))
        );
        
        if (hasConflict) {
          // 收集所有冲突的错误信息
          const conflictErrors = res.result.results
            .filter(result => result.success === false && result.error)
            .map(result => result.error)
            .filter((error, index, arr) => arr.indexOf(error) === index); // 去重
          
          // 有冲突，使用增量更新刷新页面状态并提示用户
          this.updateCourtStatusIncrementally(date);
          wx.showModal({
            title: '预订冲突',
            content: conflictErrors.length > 0 ? conflictErrors.join('\n') : '场地已被预订',
            showCancel: false,
            success: () => {
              // 清空选中状态
              this.clearSelectedStatus();
              // 重置处理订单状态
              this.setData({ isProcessingOrder: false });
            }
          });
          return;
        }
        
        // 检查是否所有操作都成功
        const allSuccess = res.result.results.every(result => result.success);
        if (!allSuccess) {
          wx.showModal({
            title: '部分预订失败',
            content: '部分场地预订失败，请重试',
            showCancel: false,
            success: () => {
              this.updateCourtStatusIncrementally(date);
              this.clearSelectedStatus();
              // 重置处理订单状态
              this.setData({ isProcessingOrder: false });
            }
          });
          return;
        }
        
        // 管理员预订：已在 update_court_order 中创建 pay_order，无需显示支付弹窗
        if (res.result.isAdminBooking) {
          wx.showToast({
            title: '管理员预订成功',
            icon: 'success'
          });
          this.setData({ isProcessingOrder: false });
          this.clearSelectedStatus();
          setTimeout(() => {
            this.initCourtStatusByCloud(date);
          }, 1500);
          return;
        }
        
        // 普通会员：显示支付弹窗，需点击确定后创建 pay_order
        this.setData({
          showPaymentModal: true,
          paymentModalData: {
            results: res.result.results,
            date: date,
            total_fee: total_fee
          }
        });
      },
      fail: err => {
        wx.showToast({ title: '预订失败', icon: 'none' });
        console.error('预订失败:', err);
        // 重置处理订单状态
        this.setData({ isProcessingOrder: false });
        this.clearSelectedStatus();
      }
    });
  },
  // 生成随机字符串
  generateNonceStr() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const timestamp = Date.now().toString(36); // 将时间戳转换为36进制
    const randomPart = Math.random().toString(36).substring(2, 8); // 获取随机数的一部分
    result = timestamp + randomPart;
    
    // 如果长度不够32位，继续添加随机字符
    while (result.length < 32) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // 如果超过32位，截取前32位
    return result.substring(0, 32);
  },
  onCreateOrderPayment: function (order_objs,date,price) {
    // Get global managerList
    const app = getApp();
    const managerList = app.globalData.managerList;
    console.log('Global managerList:', managerList);

    // Get user's phone number and check if in managerList
    const userPhone = this.data.phoneNumber;
    const isManager = managerList && managerList.includes(userPhone);
    console.log('User phone:', userPhone);
    console.log('Is user a manager:', isManager);

    const court_ids = []
    order_objs.forEach(item => {
      court_ids.push(item.court_id)
    })
    const orderParams = {
      phoneNumber: this.data.phoneNumber,
      // total_fee: court_ids.length/100,
      total_fee: price,
      court_ids,
      campus: this.data.currentCampus,
      nonceStr: this.generateNonceStr()
    };
    wx.showLoading({ title: '加载中...' });
    // 调用云函数创建订单
    wx.cloud.callFunction({
      name: 'pay_order_create',
      data: orderParams,
      success: (res) => {
        console.log('创建订单成功', res);
        
        // 检查是否有重复订单错误
        if (res.result && res.result.success === false && res.result.error === 'DUPLICATE_ORDER') {
          wx.hideLoading();
          wx.showToast({
            title: res.result.message || '所选场地已被预订',
            icon: 'none',
            duration: 3000
          });
          // 清空所有临时选中的场地
          this.clearSelectedStatus();
          // 重置处理订单状态
          this.setData({ isProcessingOrder: false });
          return;
        }
        
        if (res.result && res.result.payment) {
          if (isManager) {
            // Skip payment for managers
            wx.hideLoading();
            wx.showToast({
              title: '管理员预订成功',
              icon: 'success'
            });
            console.log('管理员预订成功');
            // 重置处理订单状态
            this.setData({ isProcessingOrder: false });
            this.clearSelectedStatus();
            setTimeout(() => {
              this.initCourtStatusByCloud(date);
            }, 1500);
          } else {
            // 调用微信支付
            wx.requestPayment({
              ...res.result.payment,
                             success: (payRes) => {
                 wx.hideLoading();
                 wx.showToast({
                   title: '支付成功',
                   icon: 'success'
                 });
                 console.log('支付成功', payRes);
                 // 重置处理订单状态
                 this.setData({ isProcessingOrder: false });
                 // 清空所有临时选中的场地
                 this.clearSelectedStatus();
                 setTimeout(() => {
                   this.initCourtStatusByCloud(date);
                 }, 1500);
               },
                             fail: (err) => {
                 wx.hideLoading();
                 wx.showToast({
                   title: '支付失败',
                   icon: 'error'
                 });
                 console.error('支付失败', err);
                 // 重置处理订单状态
                 this.setData({ isProcessingOrder: false });
                 // 清空所有临时选中的场地
                 this.clearSelectedStatus();
               }
            });
          }
        } else {
          wx.hideLoading();
          wx.showToast({
            title: '创建订单失败',
            icon: 'error'
          });
          // 重置处理订单状态
          this.setData({ isProcessingOrder: false });
          this.clearSelectedStatus();
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({
          title: '创建订单失败',
          icon: 'error'
        });
        console.error('创建订单失败', err);
        // 重置处理订单状态
        this.setData({ isProcessingOrder: false });
        this.clearSelectedStatus();
      }
    });


  },

  onGoToLogin: function() {

    wx.switchTab({
      url: '/pages/member/member'
    });
    console.log('--------onGoToLogin-------')
  },

  // 显示场馆分布弹窗
  showVenueDistribution: function() {
    this.setData({
      showVenueModal: true
    });
  },

  // 隐藏场馆分布弹窗
  hideVenueModal: function() {
    this.setData({
      showVenueModal: false
    });
  },

  // 阻止事件冒泡
  stopPropagation: function() {
    // 空函数，用于阻止事件冒泡
  },

  // 确认支付提醒弹窗
  confirmPaymentModal: function() {
    const { paymentModalData } = this.data;
    if (paymentModalData) {
      wx.showLoading({ title: '加载中...' });
      this.updateCourtStatusIncrementally(paymentModalData.date);
      console.log('云函数返回:', paymentModalData.results);
      this.onCreateOrderPayment(paymentModalData.results, paymentModalData.date, paymentModalData.total_fee);
      wx.hideLoading();
    }
    // 关闭弹窗
    this.setData({
      showPaymentModal: false,
      paymentModalData: null
    });
  },

  // 预览图片
  previewImage: function(e) {
    const current = e.currentTarget.dataset.url;
    wx.previewImage({
      current: current,
      urls: this.data.venueImages
    });
  },

  // 显示校区选择器
  showCampusPicker: function() {
    this.setData({
      showCampusPicker: true
    });
  },

  // 隐藏校区选择器
  hideCampusPicker: function() {
    this.setData({
      showCampusPicker: false
    });
  },

  // 选择校区
  onCampusSelect: function(e) {
    const selectedCampus = e.currentTarget.dataset.campus;
    if (selectedCampus !== this.data.currentCampus) {
      this.setData({
        currentCampus: selectedCampus,
        showCampusPicker: false
      });

      // 重新初始化时间列表（根据新校区）
      this.initTimeList();

      // 清空选中状态并重新加载数据
      this.clearSelectedStatus();
      this.initCourtListByCloud();
      this.initCourtStatusByCloud(this.data.currentDate);
    } else {
      this.setData({
        showCampusPicker: false
      });
    }
  },

  // 阻止校区选择器事件冒泡
  stopCampusPickerPropagation: function() {
    // 空函数，用于阻止事件冒泡
  },
}); 
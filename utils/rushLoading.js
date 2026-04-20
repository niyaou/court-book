// 畅打请求统一：转圈 + 6 秒超时提示「超时重试」
const RUSH_LOADING_MS = 6000;

function withRushLoading(fn, title = '加载中...') {
  wx.showLoading({ title });
  let done = false;
  let timeoutId;
  const timeoutPromise = new Promise((_, rej) => {
    timeoutId = setTimeout(() => {
      if (done) return;
      done = true;
      wx.hideLoading();
      wx.showToast({ title: '超时重试', icon: 'none' });
      rej({ timeout: true });
    }, RUSH_LOADING_MS);
  });
  return Promise.race([Promise.resolve().then(fn), timeoutPromise])
    .then((result) => {
      if (!done) { done = true; clearTimeout(timeoutId); wx.hideLoading(); }
      return result;
    })
    .catch((e) => {
      if (!done) { done = true; clearTimeout(timeoutId); wx.hideLoading(); }
      throw e;
    });
}

module.exports = { withRushLoading };

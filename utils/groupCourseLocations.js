// GCJ-02 coordinates for wx.openLocation. Sources: docs/group-course-locations.md.
const locations = {
  "麓坊校区": {
    name: "乐动网球（麓坊校区）",
    address: "四川省成都市麓坊街93号",
    latitude: 30.461094427278926,
    longitude: 104.05406090412829,
  },
  "雅居乐校区": {
    name: "乐动网球（雅居乐草地校区）",
    address: "四川省成都市双流区麓山大道二段19号，正熙雅居酒店内",
    latitude: 30.480215,
    longitude: 104.137134,
  },
  "华府校区": {
    name: "乐动网球（华府校区）",
    address: "四川省成都市双流区",
    hint: "查看地图定位，具体入场位置请联系教练",
    latitude: 30.526317,
    longitude: 104.056563,
  },
  "英郡校区": {
    name: "乐动网球（英郡校区）",
    address: "四川省成都市天华路509号，英郡一期南门",
    latitude: 30.543125,
    longitude: 104.073025,
  },
};

function campusLocation(campus) {
  if (typeof campus !== "string") return null;
  const key = campus.trim();
  if (!Object.prototype.hasOwnProperty.call(locations, key)) return null;
  return Object.assign({}, locations[key]);
}

module.exports = { campusLocation };

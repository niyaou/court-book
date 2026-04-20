// 按校区名稳定映射，8 种冷暖均衡、易区分的颜色
const PALETTE = ['#d32f2f', '#3949ab', '#00897b', '#388e3c', '#0097a7', '#1976d2', '#7b1fa2', '#c2185b'];

function hashStr(str) {
  if (!str || typeof str !== 'string') return 0;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function getIndex(campus) {
  let idx = hashStr(campus) % PALETTE.length;
  if (campus === '麓坊校区') idx = hashStr('桐梓林校区') % PALETTE.length;
  else if (campus === '桐梓林校区') idx = hashStr('麓坊校区') % PALETTE.length;
  return idx;
}

function getCampusColor(campus) {
  return PALETTE[getIndex(campus)];
}

function getCampusColorIndex(campus) {
  return getIndex(campus);
}

module.exports = { getCampusColor, getCampusColorIndex };

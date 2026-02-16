const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('member login flow should not call getUserProfile in getPhoneNumber callback', () => {
  const source = fs.readFileSync('pages/member/member.js', 'utf8');

  assert.equal(source.includes('await this.getOpenId();'), false, 'should not await openid before profile step');
  assert.equal(source.includes('wx.getUserProfile('), false, 'should not use deprecated getUserProfile flow');
  assert.notEqual(source.indexOf('needsProfileCompletion: true'), -1, 'should enter profile-completion state after phone auth');
});

test('member page should use chooseAvatar and nickname input for profile completion', () => {
  const source = fs.readFileSync('pages/member/member.wxml', 'utf8');

  assert.notEqual(source.indexOf('open-type="chooseAvatar"'), -1, 'should provide chooseAvatar button');
  assert.notEqual(source.indexOf('type="nickname"'), -1, 'should provide nickname input type');
  assert.notEqual(source.indexOf('profile-panel-mask'), -1, 'should render lightweight profile panel mask');
  assert.notEqual(source.indexOf('profile-panel-card'), -1, 'should render lightweight profile panel card');
});

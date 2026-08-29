function canProcessCancelledRush(rush, internal) {
  if (!rush) return false;
  return internal || !rush.deleted_at;
}

module.exports = {
  canProcessCancelledRush,
};

"use strict";
const { BusinessError } = require("./core");
// CloudBase transactions support document operations. Queries are read before the
// transaction and checked against the owning course version inside it.
function createRepository(db) {
  const get = async (root, name, id) => {
    try {
      const r = await root.collection(name).doc(id).get();
      return r.data || null;
    } catch (e) {
      if (
        /DOCUMENT_NOT_EXIST|document.*not.*exist|does not exist/i.test(
          String(e.errCode) + " " + e.message,
        )
      )
        return null;
      throw e;
    }
  };
  const wrap = (root) => ({
    get: (name, id) => get(root, name, id),
    set: async (name, id, data) => {
      const value = { ...data };
      delete value._id;
      await root.collection(name).doc(id).set({ data: value });
    },
  });
  return {
    ...wrap(db),
    async scan(name, where = {}) {
      const all = [];
      let last;
      for (;;) {
        const filter = last
          ? db.command.and(where, { _id: db.command.gt(last) })
          : where;
        const r = await db
          .collection(name)
          .where(filter)
          .orderBy("_id", "asc")
          .limit(100)
          .get();
        all.push(...r.data);
        if (r.data.length < 100) return all;
        last = r.data[r.data.length - 1]._id;
      }
    },
    async transaction(fn) {
      const tx = await db.startTransaction();
      try {
        const result = await fn(wrap(tx));
        await tx.commit();
        return result;
      } catch (e) {
        try {
          await tx.rollback();
        } catch (_) {}
        if (
          /TRANSACTION_CONFLICT|DATABASE_TRANSACTION_CONFLICT|write conflict|transaction.*conflict|duplicate.*key|duplicate.*index/i.test(
            String(e.errCode) + " " + e.message,
          )
        )
          throw new BusinessError(
            "RETRYABLE_CONFLICT",
            "RETRYABLE_CONFLICT",
            true,
          );
        throw e;
      }
    },
  };
}
module.exports = { createRepository };

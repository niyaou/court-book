function mapNotice(row) {
  return {
    id: Number(row.id),
    coachId: Number(row.coachId),
    coachName: row.coachName || '',
    coachActive: Boolean(Number(row.coachActive)),
    memberId: Number(row.memberId),
    memberName: row.memberName || '',
    memberNumber: row.memberNumber || '',
    memberActive: Boolean(Number(row.memberActive)),
    rechargeDate: row.rechargeDate,
    note: row.note,
    status: row.status,
    version: Number(row.version),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    acknowledgedAt: row.acknowledgedAt || null
  }
}

module.exports = { mapNotice }

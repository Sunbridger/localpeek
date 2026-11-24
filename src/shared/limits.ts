/** 集中放置不对外暴露的实现上限，便于后续调整。 */
export const LIMITS = {
  webLogLines: 200,
  webLogTailBytes: 512 * 1024,
  webLogPollMs: 500,
  webLogMaxLine: 4000,
  redisDetailLimit: 1000,
  redisStringLimit: 256 * 1024,
  redisPreviewBytes: 320,
  redisPreviewChars: 160,
  mysqlPageSizes: [50, 100, 200, 500] as const,
  mysqlDefaultPageSize: 100
} as const

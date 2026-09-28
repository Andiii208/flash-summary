/**
 * H30 (audit 2026-09-28): 平台路径常量族——从 auth/cas-login 上移到 school 域。
 *
 * 为什么在这里：这些常量描述的是**学校平台**的 URL 形状，消费方横跨两个域——
 * auth（cas-login / main-window-login）与 school（play-harvest）。旧形态是
 * school/play-harvest 反向 import auth/cas-login 拿 `PLATFORM_API_BASE_PATH`，
 * 分层倒置（school 域依赖 auth 域）。常量本身零依赖，放 school 域后三个消费方
 * 都从这里导入，依赖方向统一为「auth → school」，不成环。
 *
 * 唯一事实源：本文件。cas-login 的再导出只为兼容既有 import，新代码一律
 * 直接从本模块导入。
 */

/** API base path on the platform origin (only static UI assets carry the -ui suffix). */
export const PLATFORM_API_BASE_PATH = '/jy-application-resourcemanage'

/** API path used to detect that the session works (course list pagination, jwt-token authenticated). */
export const SESSION_PROBE_PATH = '/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=1'

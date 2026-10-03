declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_EMAILS?: string;
    INSTAGRAM_ACCESS_TOKEN?: string;
    INSTAGRAM_BUSINESS_ACCOUNT_ID?: string;
    INSTAGRAM_GRAPH_VERSION?: string;
    INSTAGRAM_SOURCE_HANDLES?: string;
  }
}

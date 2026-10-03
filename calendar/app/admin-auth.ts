import {
  getChatGPTUser,
  type ChatGPTUser,
} from "./chatgpt-auth.ts";

export class AdminAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AdminAccessError";
  }
}

export type RequireAdminDependencies = {
  getUser?: () => Promise<ChatGPTUser | null>;
  adminEmails?: string;
  resolveAdminEmails?: () => Promise<string | undefined>;
  nodeEnv?: string;
};

function normalizedEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function configuredAdminEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map(normalizedEmail)
      .filter(Boolean),
  );
}

async function requestScopedAdminEmails(): Promise<string | undefined> {
  const { env } = await import("cloudflare:workers");
  const value = (env as { ADMIN_EMAILS?: unknown }).ADMIN_EMAILS;
  return typeof value === "string" ? value : undefined;
}

async function adminEmailsValue(
  dependencies: RequireAdminDependencies,
  nodeEnv: string | undefined,
): Promise<string | undefined> {
  if (dependencies.adminEmails !== undefined) {
    return dependencies.adminEmails;
  }

  try {
    const binding = await (
      dependencies.resolveAdminEmails ?? requestScopedAdminEmails
    )();
    if (binding !== undefined) return binding;
  } catch {
    // The Cloudflare module is unavailable in local Node execution.
  }

  return nodeEnv === "production"
    ? undefined
    : process.env.ADMIN_EMAILS;
}

export async function requireAdmin(
  dependencies: RequireAdminDependencies = {},
): Promise<ChatGPTUser> {
  const user = await (dependencies.getUser ?? getChatGPTUser)();
  if (!user?.email.trim()) {
    throw new AdminAccessError(401, "Authentication required.");
  }

  const nodeEnv = dependencies.nodeEnv ?? process.env.NODE_ENV;
  const configured = configuredAdminEmails(
    await adminEmailsValue(dependencies, nodeEnv),
  );
  if (configured.size === 0) {
    if (nodeEnv === "production") {
      throw new AdminAccessError(
        503,
        "Administrator access is not configured.",
      );
    }
    throw new AdminAccessError(403, "Administrator access required.");
  }

  if (!configured.has(normalizedEmail(user.email))) {
    throw new AdminAccessError(403, "Administrator access required.");
  }
  return user;
}

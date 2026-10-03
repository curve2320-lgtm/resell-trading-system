import { and, asc, eq } from "drizzle-orm";
import {
  releaseCatalog,
  savedReleases,
} from "../db/schema.ts";
import { requestHasAllowedOrigin } from "./request-origin.ts";

export interface SavedReleaseRepository {
  listReleaseIds(userEmail: string): Promise<string[]>;
  save(
    userEmail: string,
    releaseId: string,
    createdAt: string,
  ): Promise<boolean>;
  remove(userEmail: string, releaseId: string): Promise<void>;
}

type SavedReleaseDb = ReturnType<
  (typeof import("../db/index.ts"))["getDb"]
>;
type SavedReleaseDbProvider = () => Promise<SavedReleaseDb>;

type SavedReleaseUser = {
  email: string;
};

type SavedReleaseHandlerDependencies = {
  getUser: () => Promise<SavedReleaseUser | null>;
  repository: SavedReleaseRepository;
  now?: () => string;
};

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
};

function createRepository(
  getDb: SavedReleaseDbProvider,
): SavedReleaseRepository {
  return {
    async listReleaseIds(userEmail) {
      const db = await getDb();
      const rows = await db
        .select({ releaseId: savedReleases.releaseId })
        .from(savedReleases)
        .where(eq(savedReleases.userEmail, userEmail))
        .orderBy(asc(savedReleases.releaseId));
      return rows.map((row) => row.releaseId);
    },

    async save(userEmail, releaseId, createdAt) {
      const db = await getDb();
      const [catalogRelease] = await db
        .select({ id: releaseCatalog.id })
        .from(releaseCatalog)
        .where(eq(releaseCatalog.id, releaseId))
        .limit(1);
      if (!catalogRelease) return false;

      await db
        .insert(savedReleases)
        .values({ userEmail, releaseId, createdAt })
        .onConflictDoNothing({
          target: [savedReleases.userEmail, savedReleases.releaseId],
        });
      return true;
    },

    async remove(userEmail, releaseId) {
      const db = await getDb();
      await db
        .delete(savedReleases)
        .where(
          and(
            eq(savedReleases.userEmail, userEmail),
            eq(savedReleases.releaseId, releaseId),
          ),
        );
    },
  };
}

export function createSavedReleaseRepositoryWithDb(
  db: SavedReleaseDb,
): SavedReleaseRepository {
  return createRepository(async () => db);
}

export function createSavedReleaseRepository(): SavedReleaseRepository {
  return createRepository(async () => {
    const { getDb } = await import("../db/index.ts");
    return getDb();
  });
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function validReleaseId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function createSavedReleaseHandlers({
  getUser,
  repository,
  now = () => new Date().toISOString(),
}: SavedReleaseHandlerDependencies) {
  async function authenticatedEmail(): Promise<string | null> {
    const user = await getUser();
    const email = user?.email.trim();
    return email || null;
  }

  async function GET(_request: Request): Promise<Response> {
    try {
      const userEmail = await authenticatedEmail();
      if (!userEmail) {
        return jsonResponse(
          { error: "Authentication required." },
          401,
        );
      }

      const releaseIds = await repository.listReleaseIds(userEmail);
      return jsonResponse({ releaseIds });
    } catch {
      return jsonResponse(
        { error: "Saved releases are temporarily unavailable." },
        500,
      );
    }
  }

  async function POST(request: Request): Promise<Response> {
    try {
      const userEmail = await authenticatedEmail();
      if (!userEmail) {
        return jsonResponse(
          { error: "Authentication required." },
          401,
        );
      }
      if (!requestHasAllowedOrigin(request)) {
        return jsonResponse(
          { error: "Request origin is not allowed." },
          403,
        );
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse(
          { error: "A valid releaseId is required." },
          400,
        );
      }
      const releaseId =
        payload &&
        typeof payload === "object" &&
        "releaseId" in payload
          ? (payload as { releaseId?: unknown }).releaseId
          : undefined;
      if (!validReleaseId(releaseId)) {
        return jsonResponse(
          { error: "A valid releaseId is required." },
          400,
        );
      }

      const exists = await repository.save(
        userEmail,
        releaseId,
        now(),
      );
      if (!exists) {
        return jsonResponse({ error: "Release not found." }, 404);
      }
      return jsonResponse({ releaseId });
    } catch {
      return jsonResponse(
        { error: "Saved releases are temporarily unavailable." },
        500,
      );
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const userEmail = await authenticatedEmail();
      if (!userEmail) {
        return jsonResponse(
          { error: "Authentication required." },
          401,
        );
      }
      if (!requestHasAllowedOrigin(request)) {
        return jsonResponse(
          { error: "Request origin is not allowed." },
          403,
        );
      }

      const releaseId = new URL(request.url).searchParams.get(
        "releaseId",
      );
      if (!validReleaseId(releaseId)) {
        return jsonResponse(
          { error: "A valid releaseId is required." },
          400,
        );
      }

      await repository.remove(userEmail, releaseId);
      return new Response(null, {
        status: 204,
        headers: RESPONSE_HEADERS,
      });
    } catch {
      return jsonResponse(
        { error: "Saved releases are temporarily unavailable." },
        500,
      );
    }
  }

  return { GET, POST, DELETE };
}

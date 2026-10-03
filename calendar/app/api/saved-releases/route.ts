import { getChatGPTUser } from "../../chatgpt-auth";
import {
  createSavedReleaseHandlers,
  createSavedReleaseRepository,
} from "../../saved-releases";

const handlers = createSavedReleaseHandlers({
  getUser: getChatGPTUser,
  repository: createSavedReleaseRepository(),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;

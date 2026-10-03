import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type ControllerState = {
  status:
    | "disabled"
    | "idle"
    | "loading"
    | "ready"
    | "error"
    | "unauthorized";
  savedReleaseIds: ReadonlySet<string>;
  pendingReleaseIds: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  listError: string | null;
};

type SavedReleaseController = {
  getSnapshot(): ControllerState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  toggle(releaseId: string): Promise<boolean>;
  reset(authenticated: boolean): void;
};

type ButtonView = {
  saved: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
};

type ControllerModule = {
  createSavedReleaseController?: (dependencies: {
    authenticated: boolean;
    request: typeof fetch;
  }) => SavedReleaseController;
  savedReleaseButtonView?: (
    state: ControllerState,
    releaseId: string,
  ) => ButtonView;
  savedReleaseUiAvailable?: (
    state: ControllerState,
    signedIn: boolean,
  ) => boolean;
  savedReleaseRequest?: (
    releaseId: string,
    save: boolean,
  ) => { url: string; init: RequestInit };
};

const controllerModule = (await import(
  "../app/saved-release-controller.ts"
).catch(() => ({}))) as ControllerModule;
const buttonModule = await import("../app/saved-release-button.tsx");

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class RequestHarness {
  readonly calls: { url: string; init?: RequestInit }[] = [];
  readonly responses: Deferred<Response>[] = [];

  readonly request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const response = deferred<Response>();
    this.calls.push({ url: String(input), init });
    this.responses.push(response);
    return response.promise;
  }) as typeof fetch;
}

function requireControllerModule() {
  assert.equal(
    typeof controllerModule.createSavedReleaseController,
    "function",
  );
  assert.equal(
    typeof controllerModule.savedReleaseButtonView,
    "function",
  );
  assert.equal(
    typeof controllerModule.savedReleaseUiAvailable,
    "function",
  );
  assert.equal(typeof controllerModule.savedReleaseRequest, "function");
  return {
    createController: controllerModule.createSavedReleaseController!,
    buttonView: controllerModule.savedReleaseButtonView!,
    uiAvailable: controllerModule.savedReleaseUiAvailable!,
    savedReleaseRequest: controllerModule.savedReleaseRequest!,
  };
}

async function loadController(
  releaseIds: string[] = [],
): Promise<{
  controller: SavedReleaseController;
  harness: RequestHarness;
}> {
  const { createController } = requireControllerModule();
  const harness = new RequestHarness();
  const controller = createController({
    authenticated: true,
    request: harness.request,
  });
  const loading = controller.load();
  harness.responses[0]!.resolve(Response.json({ releaseIds }));
  await loading;
  return { controller, harness };
}

test("initial loading disables mutations so a late list cannot overwrite one", async () => {
  const { createController } = requireControllerModule();
  const harness = new RequestHarness();
  const controller = createController({
    authenticated: true,
    request: harness.request,
  });

  const loading = controller.load();
  assert.equal(controller.getSnapshot().status, "loading");
  assert.equal(await controller.toggle("release-a"), false);
  assert.equal(harness.calls.length, 1);

  harness.responses[0]!.resolve(
    Response.json({ releaseIds: ["release-a"] }),
  );
  await loading;

  assert.equal(controller.getSnapshot().status, "ready");
  assert.deepEqual(
    [...controller.getSnapshot().savedReleaseIds],
    ["release-a"],
  );
  assert.deepEqual(
    [...controller.getSnapshot().pendingReleaseIds],
    [],
  );
});

test("duplicate card buttons consume one optimistic and pending state", async () => {
  const { buttonView } = requireControllerModule();
  const { controller, harness } = await loadController();
  const mutation = controller.toggle("release-a");
  const firstView = buttonView(controller.getSnapshot(), "release-a");
  const secondView = buttonView(controller.getSnapshot(), "release-a");

  assert.deepEqual(firstView, {
    saved: true,
    pending: true,
    disabled: true,
    error: null,
  });
  assert.deepEqual(secondView, firstView);

  const SavedReleaseButton =
    buttonModule.SavedReleaseButton as ComponentType<
      ButtonView & {
        releaseId: string;
        onToggle: (releaseId: string) => void;
      }
    >;
  const markup = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(SavedReleaseButton, {
        releaseId: "release-a",
        ...firstView,
        onToggle: () => {},
      }),
      createElement(SavedReleaseButton, {
        releaseId: "release-a",
        ...secondView,
        onToggle: () => {},
      }),
    ),
  );
  assert.equal(markup.match(/aria-pressed="true"/g)?.length, 2);
  assert.equal(markup.match(/aria-busy="true"/g)?.length, 2);
  assert.equal(markup.match(/ disabled=""/g)?.length, 2);

  harness.responses[1]!.resolve(
    Response.json({ releaseId: "release-a" }),
  );
  assert.equal(await mutation, true);
  assert.equal(
    buttonView(controller.getSnapshot(), "release-a").pending,
    false,
  );
});

test("opposing duplicate operations are serialized per release", async () => {
  const { controller, harness } = await loadController();
  const saving = controller.toggle("release-a");

  assert.equal(await controller.toggle("release-a"), false);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1]?.init?.method, "POST");

  harness.responses[1]!.resolve(
    Response.json({ releaseId: "release-a" }),
  );
  assert.equal(await saving, true);

  const deleting = controller.toggle("release-a");
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.calls[2]?.init?.method, "DELETE");
  harness.responses[2]!.resolve(new Response(null, { status: 204 }));
  assert.equal(await deleting, true);
  assert.deepEqual([...controller.getSnapshot().savedReleaseIds], []);
});

test("stale mutation completion cannot restore a previous authenticated state", async () => {
  const { controller, harness } = await loadController();
  const mutation = controller.toggle("release-a");
  controller.reset(false);

  harness.responses[1]!.resolve(
    Response.json({ releaseId: "release-a" }),
  );
  assert.equal(await mutation, false);
  assert.equal(controller.getSnapshot().status, "disabled");
  assert.deepEqual([...controller.getSnapshot().savedReleaseIds], []);
  assert.deepEqual([...controller.getSnapshot().pendingReleaseIds], []);
});

test("ambiguous mutation failure reconciles once with the authoritative list", async () => {
  const { controller, harness } = await loadController();
  const mutation = controller.toggle("release-a");
  harness.responses[1]!.reject(new TypeError("network lost after write"));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.calls[2]?.url, "/api/saved-releases");
  assert.equal(harness.calls[2]?.init?.method, "GET");

  harness.responses[2]!.resolve(
    Response.json({ releaseIds: ["release-a"] }),
  );
  assert.equal(await mutation, true);
  assert.deepEqual(
    [...controller.getSnapshot().savedReleaseIds],
    ["release-a"],
  );
  assert.deepEqual(
    [...controller.getSnapshot().pendingReleaseIds],
    [],
  );
  assert.equal(harness.calls.length, 3);
});

test("list and mutation 401 clear prior-user state and disable saved UI", async () => {
  const { createController, buttonView, uiAvailable } =
    requireControllerModule();
  const initialHarness = new RequestHarness();
  const initialController = createController({
    authenticated: true,
    request: initialHarness.request,
  });
  const initialLoad = initialController.load();
  initialHarness.responses[0]!.resolve(
    new Response(null, { status: 401 }),
  );
  await initialLoad;
  assert.equal(initialController.getSnapshot().status, "unauthorized");
  assert.deepEqual(
    [...initialController.getSnapshot().savedReleaseIds],
    [],
  );
  assert.equal(
    buttonView(initialController.getSnapshot(), "release-a").disabled,
    true,
  );
  assert.equal(
    uiAvailable(initialController.getSnapshot(), true),
    false,
  );

  const { controller, harness } = await loadController(["release-a"]);
  const mutation = controller.toggle("release-a");
  harness.responses[1]!.resolve(new Response(null, { status: 401 }));
  assert.equal(await mutation, false);
  assert.equal(controller.getSnapshot().status, "unauthorized");
  assert.deepEqual([...controller.getSnapshot().savedReleaseIds], []);
  assert.deepEqual([...controller.getSnapshot().pendingReleaseIds], []);
  assert.equal(uiAvailable(controller.getSnapshot(), true), false);
  assert.equal(await controller.toggle("release-a"), false);
  assert.equal(harness.calls.length, 2);
});

test("signed-out reset clears state before a later signed-in reload", async () => {
  const { controller, harness } = await loadController(["release-a"]);

  controller.reset(false);
  assert.equal(controller.getSnapshot().status, "disabled");
  assert.deepEqual([...controller.getSnapshot().savedReleaseIds], []);

  controller.reset(true);
  assert.equal(controller.getSnapshot().status, "idle");
  assert.deepEqual([...controller.getSnapshot().savedReleaseIds], []);
  const reload = controller.load();
  harness.responses[1]!.resolve(
    Response.json({ releaseIds: ["release-b"] }),
  );
  await reload;
  assert.deepEqual(
    [...controller.getSnapshot().savedReleaseIds],
    ["release-b"],
  );
});

test("controller mutation requests contain only release IDs", () => {
  const { savedReleaseRequest } = requireControllerModule();

  assert.deepEqual(savedReleaseRequest("cached:나이키-100", true), {
    url: "/api/saved-releases",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ releaseId: "cached:나이키-100" }),
    },
  });
  assert.deepEqual(savedReleaseRequest("cached:나이키-100", false), {
    url: "/api/saved-releases?releaseId=cached%3A%EB%82%98%EC%9D%B4%ED%82%A4-100",
    init: { method: "DELETE" },
  });
});

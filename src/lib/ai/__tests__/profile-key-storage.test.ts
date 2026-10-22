import { beforeEach, describe, expect, it } from "vitest";
import {
  clearProfileApiKey,
  getProfileApiKey,
  initKeyStorage,
  setProfileApiKey,
} from "../key-storage";

describe("profile-scoped AI key storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("isolates keys by profile id and clears only the selected profile", async () => {
    await initKeyStorage();
    await setProfileApiKey("profile-a", "key-a");
    await setProfileApiKey("profile-b", "key-b");

    expect(getProfileApiKey("profile-a")).toBe("key-a");
    expect(getProfileApiKey("profile-b")).toBe("key-b");
    expect(window.localStorage.getItem("lattice-ai-profile-key:profile-a")).not.toContain("key-a");

    await clearProfileApiKey("profile-a");
    expect(getProfileApiKey("profile-a")).toBe("");
    expect(getProfileApiKey("profile-b")).toBe("key-b");
  });
});

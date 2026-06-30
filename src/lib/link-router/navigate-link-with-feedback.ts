"use client";

import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { navigateLink, type NavigateLinkOptions } from "./navigate-link";

export async function navigateLinkWithFeedback(
  target: string,
  options: NavigateLinkOptions = {},
): Promise<boolean> {
  try {
    const success = await navigateLink(target, options);
    if (!success) {
      toast.error(t("markdown.links.toast.openFailed"), {
        description: t("markdown.links.toast.openFailedDescription", { target }),
      });
    }
    return success;
  } catch (error) {
    console.warn("Failed to navigate link target:", target, error);
    toast.error(t("markdown.links.toast.openFailed"), {
      description: t("markdown.links.toast.openFailedDescription", { target }),
    });
    return false;
  }
}

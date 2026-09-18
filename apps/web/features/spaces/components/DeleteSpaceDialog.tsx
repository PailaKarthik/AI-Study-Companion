"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { useToast } from "@/components/shared/toaster";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { useDeleteSpace } from "../hooks";

/**
 * Destructive confirm dialog. Names the space, warns about cascade, and
 * only deletes on explicit confirmation. No optimistic removal.
 */
export function DeleteSpaceDialog({
  spaceId,
  spaceName,
  open,
  onOpenChange,
}: {
  spaceId: string;
  spaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const deleteSpace = useDeleteSpace();
  const { success, error: notifyError } = useToast();
  const [failed, setFailed] = useState(false);

  async function handleDelete() {
    setFailed(false);
    try {
      await deleteSpace.mutateAsync(spaceId);
      success("Space deleted", `"${spaceName}" and its projects were removed.`);
      onOpenChange(false);
      router.replace("/spaces");
    } catch (err) {
      setFailed(true);
      notifyError("Could not delete space", toUserMessage(err));
    }
  }

  const error = deleteSpace.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{spaceName}”?</DialogTitle>
          <DialogDescription>
            This permanently removes the space and every project, material, and learning record
            inside it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {failed && error ? (
          <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} />
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteSpace.isPending}
          >
            {deleteSpace.isPending ? "Deleting…" : "Delete space"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

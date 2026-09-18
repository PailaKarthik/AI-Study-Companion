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
import { useDeleteProject } from "../hooks";

/** Destructive confirm dialog. No optimistic removal — waits for the API. */
export function DeleteProjectDialog({
  spaceId,
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  spaceId: string;
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const deleteProject = useDeleteProject(spaceId);
  const { success, error: notifyError } = useToast();
  const [failed, setFailed] = useState(false);

  async function handleDelete() {
    setFailed(false);
    try {
      await deleteProject.mutateAsync(projectId);
      success("Project deleted", `"${projectName}" and its learning data were removed.`);
      onOpenChange(false);
      router.replace(`/spaces/${spaceId}`);
    } catch (err) {
      setFailed(true);
      notifyError("Could not delete project", toUserMessage(err));
    }
  }

  const error = deleteProject.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{projectName}”?</DialogTitle>
          <DialogDescription>
            This permanently removes the project and all its materials, concepts, conversations,
            quizzes, and mastery history. This cannot be undone.
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
            disabled={deleteProject.isPending}
          >
            {deleteProject.isPending ? "Deleting…" : "Delete project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

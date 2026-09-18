"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { SpaceDetail } from "@ai-study-companion/shared";
import { updateSpaceSchema } from "@ai-study-companion/validation";
import { ApiErrorAlert } from "@/components/shared/api-error-alert";
import { Field } from "@/components/shared/form";
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
import { useUpdateSpace } from "../hooks";

const formSchema = updateSpaceSchema;
type FormValues = z.infer<typeof formSchema>;

/** Edit-space dialog, prefilled from the loaded space. */
export function EditSpaceDialog({
  space,
  open,
  onOpenChange,
}: {
  space: SpaceDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateSpace = useUpdateSpace(space.id);
  const { success, error: notifyError } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: space.name, description: space.description ?? "" },
  });

  useEffect(() => {
    if (open) form.reset({ name: space.name, description: space.description ?? "" });
  }, [open, space, form]);

  async function onSubmit(values: FormValues) {
    try {
      const updated = await updateSpace.mutateAsync(values);
      success("Space updated", `"${updated.name}" was saved.`);
      onOpenChange(false);
    } catch (err) {
      notifyError("Could not update space", toUserMessage(err));
    }
  }

  const error = updateSpace.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit space</DialogTitle>
          <DialogDescription>Ownership cannot be changed.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Field
            id="edit-space-name"
            label="Name"
            error={form.formState.errors.name}
            registration={form.register("name")}
            inputProps={{ autoComplete: "off" }}
          />
          <Field
            id="edit-space-description"
            label="Description"
            error={form.formState.errors.description}
            registration={form.register("description")}
            inputProps={{ autoComplete: "off" }}
          />
          {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateSpace.isPending}>
              {updateSpace.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

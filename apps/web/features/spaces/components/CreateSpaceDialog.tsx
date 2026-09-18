"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createSpaceSchema } from "@ai-study-companion/validation";
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
import { useCreateSpace } from "../hooks";

const formSchema = createSpaceSchema;
type FormValues = z.infer<typeof formSchema>;

/** Create-space dialog. On success closes, toasts, and opens the new space. */
export function CreateSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createSpace = useCreateSpace();
  const { success, error: notifyError } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      const space = await createSpace.mutateAsync(values);
      success("Space created", `"${space.name}" is ready.`);
      form.reset();
      onOpenChange(false);
      router.push(`/spaces/${space.id}`);
    } catch (err) {
      notifyError("Could not create space", toUserMessage(err));
    }
  }

  const error = createSpace.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New space</DialogTitle>
          <DialogDescription>Group your learning by subject or goal.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Field
            id="space-name"
            label="Name"
            error={form.formState.errors.name}
            registration={form.register("name")}
            inputProps={{ placeholder: "Computer Science", autoComplete: "off" }}
          />
          <Field
            id="space-description"
            label="Description (optional)"
            error={form.formState.errors.description}
            registration={form.register("description")}
            inputProps={{ placeholder: "What is this space for?", autoComplete: "off" }}
          />
          {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSpace.isPending}>
              {createSpace.isPending ? "Creating…" : "Create space"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

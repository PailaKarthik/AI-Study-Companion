"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { ProjectDetail, ProjectStatus } from "@ai-study-companion/shared";
import { updateProjectSchema } from "@ai-study-companion/validation";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, toUserMessage } from "@/lib/api/errors";
import { useUpdateProject } from "../hooks";

const formSchema = updateProjectSchema;
type FormValues = z.infer<typeof formSchema>;

const STATUS_OPTIONS: ProjectStatus[] = ["ACTIVE", "ARCHIVED", "COMPLETED"];

/** Edit-project dialog: name, description, goal, status. Ownership immutable. */
export function EditProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateProject = useUpdateProject(project.id, project.spaceId);
  const { success, error: notifyError } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: project.name,
      description: project.description ?? "",
      goal: project.goal ?? "",
      status: project.status,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: project.name,
        description: project.description ?? "",
        goal: project.goal ?? "",
        status: project.status,
      });
    }
  }, [open, project, form]);

  async function onSubmit(values: FormValues) {
    try {
      const updated = await updateProject.mutateAsync(values);
      success("Project updated", `"${updated.name}" was saved.`);
      onOpenChange(false);
    } catch (err) {
      notifyError("Could not update project", toUserMessage(err));
    }
  }

  const error = updateProject.error;
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;
  const goalError = form.formState.errors.goal;
  const statusError = form.formState.errors.status;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Ownership and location cannot be changed.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Field
            id="edit-project-name"
            label="Project name"
            error={form.formState.errors.name}
            registration={form.register("name")}
            inputProps={{ autoComplete: "off" }}
          />
          <Field
            id="edit-project-description"
            label="Description"
            error={form.formState.errors.description}
            registration={form.register("description")}
            inputProps={{ autoComplete: "off" }}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-project-goal" className="text-sm font-medium">
              Learning goal
            </label>
            <Textarea
              id="edit-project-goal"
              aria-invalid={goalError ? true : undefined}
              aria-describedby={goalError ? "edit-project-goal-error" : undefined}
              {...form.register("goal")}
            />
            {goalError?.message ? (
              <p id="edit-project-goal-error" role="alert" className="text-sm text-destructive">
                {goalError.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-project-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="edit-project-status"
              aria-invalid={statusError ? true : undefined}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register("status")}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0) + status.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            {statusError?.message ? (
              <p role="alert" className="text-sm text-destructive">
                {statusError.message}
              </p>
            ) : null}
          </div>
          {error ? <ApiErrorAlert message={toUserMessage(error)} requestId={requestId} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProject.isPending}>
              {updateProject.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

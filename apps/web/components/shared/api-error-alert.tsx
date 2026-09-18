import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";

export function ApiErrorAlert({ message, requestId }: { message: string; requestId?: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>Request failed</AlertTitle>
      <AlertDescription>
        {message}
        {requestId ? (
          <span className="mt-1 block font-mono text-xs opacity-70">Request ID: {requestId}</span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

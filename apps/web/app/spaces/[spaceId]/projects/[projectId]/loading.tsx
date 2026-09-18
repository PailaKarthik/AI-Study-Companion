import { PageContainer } from "@/components/shared/page";
import { ProjectSkeleton } from "@/components/shared/skeletons";

/** Instant skeleton while the project dashboard loads on navigation. */
export default function ProjectLoading() {
  return (
    <PageContainer>
      <ProjectSkeleton />
    </PageContainer>
  );
}

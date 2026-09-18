import { PageContainer } from "@/components/shared/page";
import { SpacesGridSkeleton } from "@/components/shared/skeletons";

/** Instant skeleton while the spaces list loads on navigation. */
export default function SpacesLoading() {
  return (
    <PageContainer>
      <SpacesGridSkeleton />
    </PageContainer>
  );
}

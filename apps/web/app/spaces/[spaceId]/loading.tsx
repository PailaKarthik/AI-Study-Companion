import { PageContainer } from "@/components/shared/page";
import { SpaceDetailSkeleton } from "@/components/shared/skeletons";

/** Instant skeleton while the space detail loads on navigation. */
export default function SpaceLoading() {
  return (
    <PageContainer>
      <SpaceDetailSkeleton />
    </PageContainer>
  );
}

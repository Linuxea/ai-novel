import { RelationshipGraph } from "@/components/graph/relationship-graph";

type Props = { params: Promise<{ id: string }> };

export default async function RelationshipsPage({ params }: Props) {
  const { id } = await params;
  return <RelationshipGraph projectId={id} />;
}

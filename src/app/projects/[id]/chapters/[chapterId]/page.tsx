import { ChapterEditor } from "@/components/chapters/chapter-editor";

type Props = {
  params: Promise<{ id: string; chapterId: string }>;
};

export default async function ChapterPage({ params }: Props) {
  const { id, chapterId } = await params;
  return <ChapterEditor projectId={id} chapterId={chapterId} />;
}

import { ChatPanel } from "@/components/chat/chat-panel";

type Props = { params: Promise<{ id: string }> };

export default async function ChatPage({ params }: Props) {
  const { id } = await params;
  return <ChatPanel projectId={id} />;
}

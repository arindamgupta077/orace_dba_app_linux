import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ChatWithDb } from "@/components/chat/dba-chat";

export default function ChatPage() {
  return (
    <>
      <PageHeader
        title="Chat with DB"
        description="Ask your Oracle database anything in plain English — powered by AI via n8n."
        icon={MessageSquare}
      />
      <ChatWithDb />
    </>
  );
}

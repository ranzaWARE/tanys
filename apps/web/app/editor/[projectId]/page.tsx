import { Editor } from "./editor-client";

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <Editor projectId={projectId} />;
}

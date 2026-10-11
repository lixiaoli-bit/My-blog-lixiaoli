import MindMapWorkspace from './MindMapWorkspace';
export default function MindMapEditor({ mapId }: { mapId: string; initialTitle?: string; initialData?: string; blockMap?: Record<string, unknown> }) { return <MindMapWorkspace mapId={mapId} />; }

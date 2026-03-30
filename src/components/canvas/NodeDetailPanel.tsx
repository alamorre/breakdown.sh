'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Trash2, Plus, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useGraphStore, type CanvasNode, type CanvasEdge } from '@/store/graph-store';
import { updateNode, deleteNode } from '@/actions/node-actions';
import { NODE_TYPE_CONFIG, type NodeType, type EvidenceItem, type ThesisNode } from '@/types/node';
import { EDGE_TYPE_CONFIG, type EdgeType } from '@/types/edge';

interface NodeFormProps {
  thesisNode: ThesisNode;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string;
  updateNodeData: (nodeId: string, updates: Partial<ThesisNode>) => void;
  removeNode: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
}

function NodeForm({
  thesisNode,
  nodes,
  edges,
  selectedNodeId,
  updateNodeData,
  removeNode,
}: NodeFormProps) {
  const [name, setName] = useState(thesisNode.name);
  const [conclusion, setConclusion] = useState(thesisNode.conclusion ?? '');
  const [confidence, setConfidence] = useState(thesisNode.confidence);
  const [evidence, setEvidence] = useState<EvidenceItem[]>(thesisNode.evidence);
  const [assumptions, setAssumptions] = useState<string[]>(thesisNode.assumptions);
  const [newEvidence, setNewEvidence] = useState('');
  const [newAssumption, setNewAssumption] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = (updates: Record<string, unknown>) => {
    updateNodeData(selectedNodeId, updates as Partial<ThesisNode>);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const { error } = await updateNode({
        nodeId: selectedNodeId,
        ...updates,
      });
      if (error) {
        toast.error('Failed to save changes');
      }
    }, 500);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    debouncedSave({ name: value });
  };

  const handleConclusionChange = (value: string) => {
    setConclusion(value);
    debouncedSave({ conclusion: value || null });
  };

  const handleConfidenceChange = (value: number) => {
    setConfidence(value);
    debouncedSave({ confidence: value });
  };

  const handleAddEvidence = () => {
    if (!newEvidence.trim()) return;
    const item: EvidenceItem = {
      id: crypto.randomUUID(),
      content: newEvidence.trim(),
      added_at: new Date().toISOString(),
    };
    const updated = [...evidence, item];
    setEvidence(updated);
    setNewEvidence('');
    debouncedSave({ evidence: updated });
  };

  const handleRemoveEvidence = (id: string) => {
    const updated = evidence.filter((e) => e.id !== id);
    setEvidence(updated);
    debouncedSave({ evidence: updated });
  };

  const handleAddAssumption = () => {
    if (!newAssumption.trim()) return;
    const updated = [...assumptions, newAssumption.trim()];
    setAssumptions(updated);
    setNewAssumption('');
    debouncedSave({ assumptions: updated });
  };

  const handleRemoveAssumption = (index: number) => {
    const updated = assumptions.filter((_, i) => i !== index);
    setAssumptions(updated);
    debouncedSave({ assumptions: updated });
  };

  const handleDelete = async () => {
    const { error } = await deleteNode({ nodeId: selectedNodeId });
    if (error) {
      toast.error('Failed to delete node');
      return;
    }
    removeNode(selectedNodeId);
    setDeleteConfirmOpen(false);
  };

  const config = NODE_TYPE_CONFIG[thesisNode.node_type as NodeType];

  const upstreamEdges = edges.filter((e) => e.data.thesisEdge.target_node_id === selectedNodeId);
  const downstreamEdges = edges.filter((e) => e.data.thesisEdge.source_node_id === selectedNodeId);

  const getNodeName = (nodeId: string): string => {
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data.thesisNode.name ?? 'Unknown';
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Badge className={config.color}>{config.label}</Badge>
        </div>
        <SheetTitle className="sr-only">{name}</SheetTitle>
        <SheetDescription className="sr-only">Edit node details</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 px-4 pb-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">Name</Label>
          <Input id="node-name" value={name} onChange={(e) => handleNameChange(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="node-conclusion">Conclusion</Label>
          <Textarea
            id="node-conclusion"
            value={conclusion}
            onChange={(e) => handleConclusionChange(e.target.value)}
            placeholder="What is the conclusion of this node?"
            rows={4}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Confidence</Label>
            <span className="text-xs text-muted-foreground">{Math.round(confidence * 100)}%</span>
          </div>
          <Slider
            value={[confidence * 100]}
            min={0}
            max={100}
            onValueChange={(value) => {
              const vals = Array.isArray(value) ? value : [value];
              handleConfidenceChange(vals[0] / 100);
            }}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>Evidence</Label>
          {evidence.map((item) => (
            <div key={item.id} className="flex items-start gap-1.5 rounded-md bg-muted p-2">
              <p className="flex-1 text-xs">{item.content}</p>
              <Button variant="ghost" size="icon-xs" onClick={() => handleRemoveEvidence(item.id)}>
                <X className="size-3" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <Input
              value={newEvidence}
              onChange={(e) => setNewEvidence(e.target.value)}
              placeholder="Add evidence..."
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddEvidence();
              }}
            />
            <Button variant="outline" size="icon-xs" onClick={handleAddEvidence}>
              <Plus className="size-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Assumptions</Label>
          {assumptions.map((item, index) => (
            <div key={index} className="flex items-start gap-1.5 rounded-md bg-muted p-2">
              <p className="flex-1 text-xs">{item}</p>
              <Button variant="ghost" size="icon-xs" onClick={() => handleRemoveAssumption(index)}>
                <X className="size-3" />
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <Input
              value={newAssumption}
              onChange={(e) => setNewAssumption(e.target.value)}
              placeholder="Add assumption..."
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddAssumption();
              }}
            />
            <Button variant="outline" size="icon-xs" onClick={handleAddAssumption}>
              <Plus className="size-3" />
            </Button>
          </div>
        </div>

        {(upstreamEdges.length > 0 || downstreamEdges.length > 0) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>Connections</Label>
              {upstreamEdges.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Upstream
                  </p>
                  {upstreamEdges.map((e) => {
                    const edgeConfig = EDGE_TYPE_CONFIG[e.data.thesisEdge.edge_type as EdgeType];
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <div
                          className="h-0.5 w-3 rounded-full"
                          style={{ backgroundColor: edgeConfig?.color }}
                        />
                        <span>{getNodeName(e.data.thesisEdge.source_node_id)}</span>
                        <Badge variant="outline" className="h-4 text-[10px]">
                          {edgeConfig?.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              {downstreamEdges.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Downstream
                  </p>
                  {downstreamEdges.map((e) => {
                    const edgeConfig = EDGE_TYPE_CONFIG[e.data.thesisEdge.edge_type as EdgeType];
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <div
                          className="h-0.5 w-3 rounded-full"
                          style={{ backgroundColor: edgeConfig?.color }}
                        />
                        <span>{getNodeName(e.data.thesisEdge.target_node_id)}</span>
                        <Badge variant="outline" className="h-4 text-[10px]">
                          {edgeConfig?.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <Separator />

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Created: {new Date(thesisNode.created_at).toLocaleDateString()}</p>
          {thesisNode.last_evaluated_at && (
            <p>Last evaluated: {new Date(thesisNode.last_evaluated_at).toLocaleDateString()}</p>
          )}
        </div>

        <Button
          variant="destructive"
          size="sm"
          className="mt-2"
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 className="size-3.5" />
          Delete Node
        </Button>
      </div>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{thesisNode.name}&rdquo; and all its connections.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NodeDetailPanel() {
  const { nodes, edges, selectedNodeId, selectNode, updateNodeData, removeNode } = useGraphStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const thesisNode = selectedNode?.data.thesisNode ?? null;

  return (
    <Sheet
      open={selectedNodeId !== null && thesisNode !== null}
      onOpenChange={(open) => {
        if (!open) selectNode(null);
      }}
    >
      <SheetContent side="right" className="w-[400px] overflow-y-auto sm:max-w-[400px]">
        {thesisNode && selectedNodeId && (
          <NodeForm
            key={selectedNodeId}
            thesisNode={thesisNode}
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            updateNodeData={updateNodeData}
            removeNode={removeNode}
            selectNode={selectNode}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

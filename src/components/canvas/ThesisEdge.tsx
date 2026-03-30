'use client';

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { EDGE_TYPE_CONFIG, type EdgeType } from '@/types/edge';
import type { CanvasEdge } from '@/store/graph-store';

function ThesisEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<CanvasEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const config = data ? EDGE_TYPE_CONFIG[data.thesisEdge.edge_type as EdgeType] : null;
  const strokeColor = config?.color ?? '#888';
  const dashArray = config?.dashArray;
  const label = config?.label ?? '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: dashArray,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <Badge
            variant="outline"
            className="cursor-pointer bg-background text-[10px] shadow-sm"
            style={{ borderColor: strokeColor, color: strokeColor }}
          >
            {label}
          </Badge>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const ThesisEdgeMemo = React.memo(ThesisEdgeComponent);

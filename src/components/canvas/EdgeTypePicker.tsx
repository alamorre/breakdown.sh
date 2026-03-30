'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { EdgeType, EDGE_TYPE_CONFIG } from '@/types/edge';

interface EdgeTypePickerProps {
  open: boolean;
  onSelect: (edgeType: EdgeType) => void;
  onCancel: () => void;
}

const EDGE_TYPES = Object.values(EdgeType);

export function EdgeTypePicker({ open, onSelect, onCancel }: EdgeTypePickerProps) {
  return (
    <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Connection Type</DialogTitle>
          <DialogDescription>How does the source node relate to the target?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {EDGE_TYPES.map((type) => {
            const config = EDGE_TYPE_CONFIG[type];
            return (
              <Button
                key={type}
                variant="ghost"
                className="h-auto justify-start px-3 py-2"
                onClick={() => onSelect(type)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-0.5 w-6 rounded-full"
                    style={{
                      backgroundColor: config.color,
                      ...(config.dashArray ? { backgroundImage: 'none' } : {}),
                    }}
                  />
                  <div className="text-left">
                    <p className="text-sm font-medium">{config.label}</p>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

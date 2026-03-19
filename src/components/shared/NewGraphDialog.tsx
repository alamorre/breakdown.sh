'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createGraph } from '@/actions/graph-actions';

export function NewGraphDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    const result = await createGraph({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    setLoading(false);

    if (result.error) {
      toast.error('Failed to create graph', { description: result.error });
      return;
    }

    setOpen(false);
    setName('');
    setDescription('');

    if (result.data) {
      router.push(`/graph/${result.data.id}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New Graph</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new graph</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            placeholder="Graph name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

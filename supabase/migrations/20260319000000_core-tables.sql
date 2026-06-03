-- Core tables for breakdown.sh: graphs, nodes, edges, evaluations
-- Includes RLS policies scoped to Clerk user_id, indexes for graph traversal,
-- and ON DELETE CASCADE for child tables.

-- ============================================================
-- GRAPHS
-- ============================================================
CREATE TABLE graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own graphs"
  ON graphs FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can insert their own graphs"
  ON graphs FOR INSERT
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can update their own graphs"
  ON graphs FOR UPDATE
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can delete their own graphs"
  ON graphs FOR DELETE
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

-- ============================================================
-- NODES
-- ============================================================
CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  name TEXT NOT NULL,
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,

  -- Reasoning state
  conclusion TEXT,
  confidence FLOAT NOT NULL DEFAULT 0.5,
  evidence JSONB NOT NULL DEFAULT '[]',
  assumptions JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Evaluation state
  skill_doc_id UUID,
  autonomy_level TEXT NOT NULL DEFAULT 'propose',
  last_evaluated_at TIMESTAMPTZ,
  evaluation_history JSONB NOT NULL DEFAULT '[]',

  -- Canvas display
  collapsed BOOLEAN NOT NULL DEFAULT false,
  color TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view nodes in their graphs"
  ON nodes FOR SELECT
  USING (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE POLICY "Users can insert nodes in their graphs"
  ON nodes FOR INSERT
  WITH CHECK (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE POLICY "Users can update nodes in their graphs"
  ON nodes FOR UPDATE
  USING (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE POLICY "Users can delete nodes in their graphs"
  ON nodes FOR DELETE
  USING (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE INDEX idx_nodes_graph ON nodes(graph_id);

-- ============================================================
-- EDGES
-- ============================================================
CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  weight FLOAT NOT NULL DEFAULT 1.0,
  condition TEXT,
  transform TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(source_node_id, target_node_id)
);

ALTER TABLE edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view edges in their graphs"
  ON edges FOR SELECT
  USING (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE POLICY "Users can insert edges in their graphs"
  ON edges FOR INSERT
  WITH CHECK (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE POLICY "Users can update edges in their graphs"
  ON edges FOR UPDATE
  USING (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE POLICY "Users can delete edges in their graphs"
  ON edges FOR DELETE
  USING (graph_id IN (SELECT id FROM graphs WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'));

CREATE INDEX idx_edges_source ON edges(source_node_id);
CREATE INDEX idx_edges_target ON edges(target_node_id);

-- ============================================================
-- EVALUATIONS
-- ============================================================
CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  trigger_source TEXT,

  previous_conclusion TEXT,
  new_conclusion TEXT,
  previous_confidence FLOAT,
  new_confidence FLOAT,
  diff_summary TEXT,

  skill_doc_id UUID,
  llm_provider TEXT,
  llm_model TEXT,
  prompt_tokens INT,
  completion_tokens INT,

  status TEXT NOT NULL,
  approved_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view evaluations for nodes in their graphs"
  ON evaluations FOR SELECT
  USING (node_id IN (
    SELECT n.id FROM nodes n
    JOIN graphs g ON n.graph_id = g.id
    WHERE g.user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'
  ));

CREATE POLICY "Users can insert evaluations for nodes in their graphs"
  ON evaluations FOR INSERT
  WITH CHECK (node_id IN (
    SELECT n.id FROM nodes n
    JOIN graphs g ON n.graph_id = g.id
    WHERE g.user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'
  ));

CREATE INDEX idx_evaluations_node ON evaluations(node_id);

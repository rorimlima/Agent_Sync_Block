-- ============================================================================
-- SYNC ENGINE — Schema SQL para Supabase
-- ============================================================================
-- Execute este script no SQL Editor do Supabase Dashboard.
-- 
-- IMPORTANTE: Cada tabela DEVE ter:
--   1. id UUID (chave primária)
--   2. created_at TIMESTAMPTZ (data de criação, imutável)
--   3. updated_at TIMESTAMPTZ (atualizado automaticamente por trigger)
--   4. is_deleted BOOLEAN (soft delete para Delta Sync)
-- ============================================================================

-- 1. Habilitar extensão UUID se ainda não estiver ativa
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Função trigger para atualizar updated_at automaticamente
-- Garante que o timestamp vem do SERVIDOR, não do cliente (evita problemas de relógio)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. ADICIONAR COLUNAS DE SYNC EM TABELAS EXISTENTES
-- ============================================================================
-- Execute APENAS as linhas das tabelas que já existem no seu banco.
-- O ALTER TABLE ADD COLUMN IF NOT EXISTS evita erros se já existirem.

-- ── vendas ──────────────────────────────────────────────────────────────────
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Criar índice para Delta Sync (busca por updated_at)
CREATE INDEX IF NOT EXISTS idx_vendas_updated_at ON vendas (updated_at);
CREATE INDEX IF NOT EXISTS idx_vendas_is_deleted ON vendas (is_deleted) WHERE is_deleted = TRUE;

-- Trigger de updated_at
DROP TRIGGER IF EXISTS update_vendas_updated_at ON vendas;
CREATE TRIGGER update_vendas_updated_at
BEFORE UPDATE ON vendas
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── veiculos_bloqueados ─────────────────────────────────────────────────────
ALTER TABLE veiculos_bloqueados ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE veiculos_bloqueados ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_veiculos_bloqueados_updated_at ON veiculos_bloqueados (updated_at);
CREATE INDEX IF NOT EXISTS idx_veiculos_bloqueados_is_deleted ON veiculos_bloqueados (is_deleted) WHERE is_deleted = TRUE;

DROP TRIGGER IF EXISTS update_veiculos_bloqueados_updated_at ON veiculos_bloqueados;
CREATE TRIGGER update_veiculos_bloqueados_updated_at
BEFORE UPDATE ON veiculos_bloqueados
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── clientes ────────────────────────────────────────────────────────────────
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes (updated_at);
CREATE INDEX IF NOT EXISTS idx_clientes_is_deleted ON clientes (is_deleted) WHERE is_deleted = TRUE;

DROP TRIGGER IF EXISTS update_clientes_updated_at ON clientes;
CREATE TRIGGER update_clientes_updated_at
BEFORE UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── audit_logs ──────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_audit_logs_updated_at ON audit_logs (updated_at);

DROP TRIGGER IF EXISTS update_audit_logs_updated_at ON audit_logs;
CREATE TRIGGER update_audit_logs_updated_at
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── ocorrencias_agente ──────────────────────────────────────────────────────
ALTER TABLE ocorrencias_agente ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE ocorrencias_agente ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ocorrencias_agente_updated_at ON ocorrencias_agente (updated_at);

DROP TRIGGER IF EXISTS update_ocorrencias_agente_updated_at ON ocorrencias_agente;
CREATE TRIGGER update_ocorrencias_agente_updated_at
BEFORE UPDATE ON ocorrencias_agente
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── colaboradores ───────────────────────────────────────────────────────────
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_colaboradores_updated_at ON colaboradores (updated_at);

DROP TRIGGER IF EXISTS update_colaboradores_updated_at ON colaboradores;
CREATE TRIGGER update_colaboradores_updated_at
BEFORE UPDATE ON colaboradores
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. HABILITAR REALTIME NAS TABELAS
-- ============================================================================
-- O Supabase precisa que as tabelas estejam na publicação 'supabase_realtime'
-- para enviar eventos de INSERT/UPDATE/DELETE via WebSocket.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'vendas', 'veiculos_bloqueados', 'clientes', 'audit_logs', 
    'ocorrencias_agente', 'colaboradores'
  ])
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL; -- Tabela já está na publicação
    END;
  END LOOP;
END $$;

-- ============================================================================
-- 5. RPC PARA DELTA SYNC COM PAGINAÇÃO (OPCIONAL - OTIMIZAÇÃO AVANÇADA)
-- ============================================================================
-- Função RPC que retorna apenas os registros alterados desde um timestamp.
-- Útil para tabelas muito grandes onde a query direta pode ser lenta.

CREATE OR REPLACE FUNCTION get_delta_changes(
  p_table TEXT,
  p_since TIMESTAMPTZ,
  p_limit INT DEFAULT 1000
)
RETURNS SETOF JSON AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT row_to_json(t) FROM %I t WHERE updated_at > $1 ORDER BY updated_at ASC LIMIT $2',
    p_table
  ) USING p_since, p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

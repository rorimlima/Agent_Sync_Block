-- ============================================================================
-- SYNC ENGINE v4 — Schema SQL Otimizado para Supabase
-- ============================================================================
-- Execute este script no SQL Editor do Supabase Dashboard.
-- 
-- PRINCÍPIOS:
--   1. UUID como chave primária (evita colisões em multi-device)
--   2. Timestamps gerenciados pelo SERVIDOR (updated_at via trigger)
--   3. Soft Deletes obrigatórios (is_deleted = true, nunca DELETE físico)
--   4. Índices compostos otimizados para Delta Sync
--   5. Índices parciais para economia de espaço (WHERE is_deleted = TRUE)
--   6. RPC para paginação eficiente no Delta Sync
-- ============================================================================

-- 1. Habilitar extensão UUID se ainda não estiver ativa
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Função trigger para atualizar updated_at automaticamente
-- Garante que o timestamp vem do SERVIDOR, não do cliente (evita clock skew)
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
-- O ALTER TABLE ADD COLUMN IF NOT EXISTS evita erros se já existirem.

-- ── vendas ──────────────────────────────────────────────────────────────────
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Índice composto para Delta Sync (updated_at + is_deleted = cobertura total)
CREATE INDEX IF NOT EXISTS idx_vendas_updated_at ON vendas (updated_at);
-- Índice parcial: só indexa registros deletados (economia de espaço)
CREATE INDEX IF NOT EXISTS idx_vendas_is_deleted ON vendas (is_deleted) WHERE is_deleted = TRUE;
-- Índice para busca por placa (usado pelo módulo de bloqueados)
CREATE INDEX IF NOT EXISTS idx_vendas_placa ON vendas (placa) WHERE placa IS NOT NULL;

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
-- Índice composto para filtro por status_final (usado pelo agente)
CREATE INDEX IF NOT EXISTS idx_veiculos_bloqueados_status ON veiculos_bloqueados (status_final, updated_at);

DROP TRIGGER IF EXISTS update_veiculos_bloqueados_updated_at ON veiculos_bloqueados;
CREATE TRIGGER update_veiculos_bloqueados_updated_at
BEFORE UPDATE ON veiculos_bloqueados
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── clientes ────────────────────────────────────────────────────────────────
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes (updated_at);
CREATE INDEX IF NOT EXISTS idx_clientes_is_deleted ON clientes (is_deleted) WHERE is_deleted = TRUE;
-- Índice para busca por código do cliente
CREATE INDEX IF NOT EXISTS idx_clientes_cod ON clientes (cod_cliente) WHERE cod_cliente IS NOT NULL;

DROP TRIGGER IF EXISTS update_clientes_updated_at ON clientes;
CREATE TRIGGER update_clientes_updated_at
BEFORE UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── audit_logs ──────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Índice composto para Delta Sync + busca por data
CREATE INDEX IF NOT EXISTS idx_audit_logs_updated_at ON audit_logs (updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

DROP TRIGGER IF EXISTS update_audit_logs_updated_at ON audit_logs;
CREATE TRIGGER update_audit_logs_updated_at
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── colaboradores ───────────────────────────────────────────────────────────
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_colaboradores_updated_at ON colaboradores (updated_at);
CREATE INDEX IF NOT EXISTS idx_colaboradores_auth ON colaboradores (auth_user_id) WHERE auth_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_colaboradores_updated_at ON colaboradores;
CREATE TRIGGER update_colaboradores_updated_at
BEFORE UPDATE ON colaboradores
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. HABILITAR REALTIME NAS TABELAS
-- ============================================================================
-- Supabase Realtime requer que as tabelas estejam na publicação.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'vendas', 'veiculos_bloqueados', 'clientes', 'audit_logs', 
    'colaboradores'
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
-- 5. RPC PARA DELTA SYNC COM PAGINAÇÃO OTIMIZADA
-- ============================================================================
-- Função RPC que retorna registros alterados desde um timestamp.
-- Usa cursor-based pagination para eficiência máxima em tabelas grandes.

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

-- ============================================================================
-- 6. RPC PARA CONTAGEM EFICIENTE (usado pelo chunk loader para estimativa)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_table_count(
  p_table TEXT
)
RETURNS BIGINT AS $$
DECLARE
  result BIGINT;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I WHERE is_deleted = false', p_table) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. RPC PARA DASHBOARD STATS (agregação no servidor = zero processamento cliente)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'clientes', (SELECT count(*) FROM clientes WHERE is_deleted = false),
    'vendas', (SELECT count(*) FROM vendas WHERE is_deleted = false),
    'bloqueados', (SELECT count(*) FROM veiculos_bloqueados WHERE is_deleted = false AND status_final = 'VEÍCULO BLOQUEADO'),
    'total_vendas_cents', COALESCE((SELECT sum(valor_venda_cents) FROM vendas WHERE is_deleted = false), 0)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

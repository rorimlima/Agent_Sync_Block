-- ============================================================================
-- DROP SCRIPT: Remoção completa de ocorrencias_agente do Supabase
-- ============================================================================
-- Execute este script no SQL Editor do Supabase Dashboard.
-- 
-- ⚠️ ATENÇÃO: Esta operação é IRREVERSÍVEL. 
--    Certifique-se de ter um backup antes de executar.
-- ============================================================================

-- 1. Remover da publicação Realtime (evitar erro no DROP)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE ocorrencias_agente;
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

-- 2. Remover o trigger
DROP TRIGGER IF EXISTS update_ocorrencias_agente_updated_at ON ocorrencias_agente;

-- 3. Remover os índices
DROP INDEX IF EXISTS idx_ocorrencias_agente_updated_at;

-- 4. Remover a tabela (CASCADE remove automaticamente FKs, RLS policies, etc.)
DROP TABLE IF EXISTS ocorrencias_agente CASCADE;

-- 5. (Opcional) Remover o storage bucket de fotos de ocorrências
-- ⚠️ Descomente a linha abaixo APENAS se quiser remover os arquivos de fotos
-- DELETE FROM storage.objects WHERE bucket_id = 'ocorrencias';
-- DELETE FROM storage.buckets WHERE id = 'ocorrencias';

-- ============================================================================
-- VERIFICAÇÃO: Confirme que a tabela foi removida
-- ============================================================================
-- Execute esta query para confirmar:
-- SELECT tablename FROM pg_tables WHERE tablename = 'ocorrencias_agente';
-- Deve retornar 0 linhas.

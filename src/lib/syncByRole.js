/**
 * Sync By Role — Sincroniza apenas as tabelas que cada função precisa
 * TTL por tabela para evitar re-fetch desnecessário
 */

// Tabelas que cada role precisa sincronizar para offline
export const ROLE_TABLES = {
  master: ['clientes', 'vendas', 'veiculos_bloqueados', 'audit_logs'],
  financeiro: ['clientes', 'vendas'],
  documentacao: ['vendas'],
  agente: ['veiculos_bloqueados'],
};

// TTL em ms por tabela (quanto tempo o cache é considerado fresco)
export const TABLE_TTL = {
  clientes: 10 * 60 * 1000,         // 10 min — dados mudam pouco
  vendas: 5 * 60 * 1000,            // 5 min
  veiculos_bloqueados: 2 * 60 * 1000, // 2 min — agentes precisam dados frescos
  audit_logs: 5 * 60 * 1000,        // 5 min — só para dashboard
};

// Colunas mínimas para cada tabela (evitar baixar tudo)
export const TABLE_SELECT = {
  clientes: 'id,cod_cliente,razao_social,cpf_cnpj,celular,email,cidade,estado',
  vendas: 'id,cod_cliente,razao_social,placa,chassi,marca_modelo,valor_venda_cents,data_venda,bloqueio_financeiro,bloqueio_documentacao,status,vendedor',
  veiculos_bloqueados: 'id,venda_id,placa,final_placa,marca_modelo,cod_cliente,razao_social,status_financeiro,status_documentacao,status_final,bloqueado_em,chassi',
  audit_logs: 'id,acao,setor,detalhes,user_email,created_at',
};

// Filtros por role (ex: agente só vê bloqueados)
export const TABLE_FILTER = {
  agente: {
    veiculos_bloqueados: { status_final: 'VEÍCULO BLOQUEADO' },
  },
};

/**
 * Retorna as tabelas que um role precisa sincronizar
 */
export function getTablesForRole(funcao) {
  return ROLE_TABLES[funcao] || [];
}

/**
 * Retorna o TTL em ms para uma tabela
 */
export function getTTL(tableName) {
  return TABLE_TTL[tableName] || 5 * 60 * 1000;
}

/**
 * Retorna o select otimizado para uma tabela
 */
export function getSelect(tableName) {
  return TABLE_SELECT[tableName] || '*';
}

/**
 * Retorna filtros para uma tabela baseado no role
 */
export function getFilter(funcao, tableName) {
  return TABLE_FILTER[funcao]?.[tableName] || null;
}

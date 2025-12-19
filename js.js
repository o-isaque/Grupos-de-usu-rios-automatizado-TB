// Variáveis que precisam ser acessadas em onDestroy
let filterDebounce = null;

self.onInit = function () {
  const ctx = self.ctx;

  // ==== UI refs ====
  const elRootLabel = document.getElementById('ug-root-label');
  const elStatus = document.getElementById('ug-status');
  const elBackBtn = document.getElementById('ug-back-btn');

  // Form elements - Step 1
  const elCreateFormStep1 = document.getElementById('ug-create-form-step1');
  const elNextStep = document.getElementById('next-step');
  const elCancelStep1 = document.getElementById('cancel-step1');
  
  // Form elements - Step 2
  const elCreateFormStep2 = document.getElementById('ug-create-form-step2');
  const elCancelStep2 = document.getElementById('cancel-step2');
  const elFilterUnits = document.getElementById('ug-filter-units');
  // Form elements - Step 3 (user type selection)
  const elCreateFormStep3 = document.getElementById('ug-create-form-step3');
  const elCancelStep3 = document.getElementById('cancel-step3');
  const elUserTypeList = document.getElementById('ug-user-type-list');
  // Form elements - Step 4 (final confirmation)
  const elCreateFormStep4 = document.getElementById('ug-create-form-step4');
  const elCancelStep4 = document.getElementById('cancel-step4');
  const elModalConfirm = document.getElementById('confirm-create-group');
  // ===== Leitura de params vindos de outro state (wizard anterior) =====
  const stateParams = ctx.stateController?.getStateParams?.() || ctx.stateParams || {};
  const preselectedCustomerIds = Array.isArray(stateParams.selectedCustomerIds)
    ? stateParams.selectedCustomerIds
    : [];

  // ===== API: Buscar grupos de usuário do customer pai =====
  async function fetchUserGroupsOfParent(customerId) {
    // Busca grupos de usuário do tipo USER do customer pai
    const url = `/api/entityGroupInfos/CUSTOMER/${customerId}/USER?pageSize=50&page=0&sortProperty=name&sortOrder=ASC`;
    const res = await GET(url);
    let groups = [];
    if (Array.isArray(res)) {
      groups = res;
    } else if (res?.data && Array.isArray(res.data)) {
      groups = res.data;
    } else if (res?.data?.data && Array.isArray(res.data.data)) {
      groups = res.data.data;
    }
    return groups;
  }

  // ===== API: Buscar permissões de um grupo de usuário =====
  async function fetchGroupPermissions(userGroupId) {
    try {
      const url = `/api/userGroup/${userGroupId}/groupPermissions`;
      const res = await GET(url);
      
      let permissions = [];
      if (Array.isArray(res)) {
        permissions = res;
      } else if (res?.data && Array.isArray(res.data)) {
        permissions = res.data;
      }
      
      return permissions;
    } catch (e) {
      return [];
    }
  }

  // ===== API: Copiar permissões para o novo grupo =====
  async function copyGroupPermissions(newUserGroupId, sourceUserGroupId) {
    try {
      // Buscar permissões do grupo origem
      const sourcePermissions = await fetchGroupPermissions(sourceUserGroupId);
      
      if (sourcePermissions.length === 0) {
        return { copied: 0, errors: [] };
      }
      
      const copied = [];
      const errors = [];
      
      // Copiar cada permissão
      for (const perm of sourcePermissions) {
        try {
          // Criar nova permissão com o novo userGroupId
          const payload = {
            userGroupId: {
              entityType: 'ENTITY_GROUP',
              id: newUserGroupId
            },
            entityGroupId: perm.entityGroupId,
            entityGroupOwnerId: perm.entityGroupOwnerId,
            role: perm.role,
            roleId: perm.roleId,
            entityType: perm.entityType || 'ENTITY_GROUP',
            userGroupOwnerId: perm.userGroupOwnerId || null
          };
          
          const res = await POST('/api/groupPermission', payload);
          copied.push(res);
        } catch (e) {
          errors.push({ permission: perm, error: e });
        }
      }
      
      return { copied: copied.length, errors };
    } catch (e) {
      return { copied: 0, errors: [e] };
    }
  }

  // ===== API: Buscar atributos de um grupo =====
  async function fetchGroupAttributes(userGroupId) {
    try {
      const url = `/api/plugins/telemetry/ENTITY_GROUP/${userGroupId}/values/attributes/SERVER_SCOPE`;
      const res = await GET(url);
      
      let attributes = [];
      if (Array.isArray(res)) {
        attributes = res;
      } else if (res?.data && Array.isArray(res.data)) {
        attributes = res.data;
      }
      
      return attributes;
    } catch (e) {
      return [];
    }
  }

  // ===== API: Buscar clientType de um customer =====
  async function fetchCustomerClientType(customerId) {
    try {
      const url = `/api/plugins/telemetry/CUSTOMER/${customerId}/values/attributes/SERVER_SCOPE`;
      const res = await GET(url);
      
      let attributes = [];
      if (Array.isArray(res)) {
        attributes = res;
      } else if (res?.data && Array.isArray(res.data)) {
        attributes = res.data;
      }
      
      const clientTypeAttr = attributes.find(attr => attr.key === 'clientType');
      return clientTypeAttr?.value || null;
    } catch (e) {
      return null;
    }
  }

  // ====== Associação automática de Custom Menu por nome do grupo de usuário ======
  const GROUP_KEYWORD_TO_MENU = {
    'Administrator': 'e45ea0f0-c9f6-11f0-8d04-3b81fee7ca6d',
    'Maintenance Manager': '395c49e0-c9f7-11f0-8d04-3b81fee7ca6d',
    'Operations Manager': '5c0c4b20-c9f7-11f0-8d04-3b81fee7ca6d',
    'Energy Manager': '85d50280-c9f7-11f0-8d04-3b81fee7ca6d',
    'Installer': '9a9b4b60-d038-11f0-8d04-3b81fee7ca6d' // TODO: Substituir pelo ID correto
  };

  // Função para associar usuário ao Custom Menu correto, conforme o nome do grupo
  async function assignUserToCustomMenuIfNeeded(userId, groupId) {
    console.log('🔍 [CUSTOM MENU] ========== INÍCIO ==========');
    console.log('🔍 [CUSTOM MENU] Iniciando assignUserToCustomMenuIfNeeded');
    console.log('   → userId:', userId);
    console.log('   → groupId:', groupId);

    if (!userId || !groupId) {
      const errorMsg = 'userId ou groupId não fornecido. Abortando.';
      console.error('❌ [CUSTOM MENU] ' + errorMsg);
      throw new Error('[CUSTOM MENU] ' + errorMsg);
    }

    // Buscar nome do grupo pelo ID
    let groupName = '';
    try {
      console.log('🌐 [CUSTOM MENU] Buscando detalhes do grupo via GET /api/entityGroup/' + groupId);
      const groupDetails = await ctx.http.get(`/api/entityGroup/${groupId}`).toPromise();
      console.log('📦 [CUSTOM MENU] Resposta da API (grupo):', JSON.stringify(groupDetails, null, 2));
      groupName = groupDetails?.data?.name || groupDetails?.name || '';
      console.log('✅ [CUSTOM MENU] Nome do grupo encontrado: "' + groupName + '"');
    } catch (e) {
      console.error('❌ [CUSTOM MENU] Erro ao buscar grupo:', e);
      console.error('❌ [CUSTOM MENU] Stack:', e?.stack);
      throw new Error('[CUSTOM MENU] Falha ao buscar detalhes do grupo: ' + (e?.message || 'Erro desconhecido'));
    }

    if (!groupName) {
      const errorMsg = 'Nome do grupo vazio após busca. Abortando.';
      console.error('❌ [CUSTOM MENU] ' + errorMsg);
      throw new Error('[CUSTOM MENU] ' + errorMsg);
    }

    const groupNameLower = groupName.toLowerCase();
    console.log('🔎 [CUSTOM MENU] Procurando match para: "' + groupNameLower + '"');
    console.log('📋 [CUSTOM MENU] Palavras-chave disponíveis:', Object.keys(GROUP_KEYWORD_TO_MENU));

    // Procura o termo que bate (case-insensitive, substring)
    let matchedMenuId = null;
    for (const keyword in GROUP_KEYWORD_TO_MENU) {
      const keywordLower = keyword.toLowerCase();
      console.log(`   → Testando se "${groupNameLower}" contém "${keywordLower}"`);
      if (groupNameLower.includes(keywordLower)) {
        matchedMenuId = GROUP_KEYWORD_TO_MENU[keyword];
        console.log(`✅ [CUSTOM MENU] *** MATCH ENCONTRADO! ***`);
        console.log(`   → Keyword original: "${keyword}"`);
        console.log(`   → Menu ID: ${matchedMenuId}`);
        break;
      }
    }

    if (!matchedMenuId) {
      console.warn('⚠️ [CUSTOM MENU] Nenhum match encontrado para o grupo "' + groupName + '"');
      console.warn('⚠️ [CUSTOM MENU] Usuário não será associado a custom menu.');
      console.log('🔍 [CUSTOM MENU] ========== FIM (SEM MATCH) ==========');
      return; // Não é erro, apenas não há menu para este tipo de grupo
    }

    try {
      // Buscar usuários já atribuídos ao custom menu
      console.log('📥 [CUSTOM MENU] Buscando usuários já atribuídos ao menu...');
      const getEndpoint = `/api/customMenu/${matchedMenuId}/assigneeList`;
      console.log('📥 [CUSTOM MENU] GET endpoint:', getEndpoint);

      let existingUserIds = [];
      try {
        const existingResponse = await ctx.http.get(getEndpoint).toPromise();
        console.log('📦 [CUSTOM MENU] Resposta GET assignees (raw):', JSON.stringify(existingResponse, null, 2));

        const assignees = existingResponse?.data || existingResponse || [];
        console.log('📦 [CUSTOM MENU] Assignees extraídos:', assignees);
        
        existingUserIds = Array.isArray(assignees)
          ? assignees.map(user => user?.id?.id || user?.id || user).filter(id => id)
          : [];

        console.log('✅ [CUSTOM MENU] Total de usuários existentes:', existingUserIds.length);
        console.log('   → IDs existentes:', JSON.stringify(existingUserIds, null, 2));
      } catch (getError) {
        console.warn('⚠️ [CUSTOM MENU] Erro ao buscar usuários existentes (continuando com lista vazia):', getError);
        console.warn('⚠️ [CUSTOM MENU] Stack:', getError?.stack);
      }

      // Verificar se o usuário já está na lista
      if (existingUserIds.includes(userId)) {
        console.log('ℹ️ [CUSTOM MENU] Usuário ' + userId + ' já está atribuído a este menu. Nada a fazer.');
        console.log('🔍 [CUSTOM MENU] ========== FIM (JÁ ATRIBUÍDO) ==========');
        return;
      }

      // Adicionar o novo usuário à lista existente
      const allUserIds = [...existingUserIds, userId];
      console.log('📝 [CUSTOM MENU] Lista completa de usuários (existentes + novo):');
      console.log('   → Total:', allUserIds.length);
      console.log('   → IDs:', JSON.stringify(allUserIds, null, 2));

      // Enviar PUT com todos os usuários (existentes + novo)
      const endpoint = `/api/customMenu/${matchedMenuId}/assign/USERS?force=false`;
      const body = allUserIds;
      console.log('🚀 [CUSTOM MENU] Enviando requisição PUT...');
      console.log('   → Endpoint:', endpoint);
      console.log('   → Body:', JSON.stringify(body, null, 2));

      const response = await ctx.http.put(endpoint, body, {
        headers: { 'Content-Type': 'application/json' }
      }).toPromise();

      console.log('✅✅✅ [CUSTOM MENU] SUCESSO! Usuário associado ao custom menu!');
      console.log('📥 [CUSTOM MENU] Resposta PUT:', JSON.stringify(response, null, 2));
      console.log('🔍 [CUSTOM MENU] ========== FIM (SUCESSO) ==========');
    } catch (e) {
      console.error('❌❌❌ [CUSTOM MENU] ERRO CRÍTICO ao associar usuário ao custom menu!');
      console.error('   → Status HTTP:', e?.status);
      console.error('   → Mensagem:', e?.data?.message || e?.message);
      console.error('   → Detalhes completos:', e);
      console.error('   → Stack:', e?.stack);
      console.log('🔍 [CUSTOM MENU] ========== FIM (ERRO) ==========');
      throw new Error('[CUSTOM MENU] Falha ao associar usuário: ' + (e?.message || 'Erro desconhecido'));
    }
  }

  // ===== API: Copiar atributos para o novo grupo =====
  async function copyGroupAttributes(newUserGroupId, sourceUserGroupId) {
    try {
      // Buscar atributos do grupo origem
      const sourceAttributes = await fetchGroupAttributes(sourceUserGroupId);
      
      if (sourceAttributes.length === 0) {
        return { copied: 0, errors: [] };
      }
      
      // Preparar payload para POST de atributos
      const attributesPayload = {};
      sourceAttributes.forEach(attr => {
        if (attr.key) {
          attributesPayload[attr.key] = attr.value;
        }
      });
      
      if (Object.keys(attributesPayload).length === 0) {
        return { copied: 0, errors: [] };
      }
      
      // Enviar atributos para o novo grupo
      const url = `/api/plugins/telemetry/ENTITY_GROUP/${newUserGroupId}/SERVER_SCOPE`;
      await POST(url, attributesPayload);
      
      return { copied: Object.keys(attributesPayload).length, errors: [] };
    } catch (e) {
      return { copied: 0, errors: [e] };
    }
  }    // ===== Etapa 3: Seleção do tipo de usuário =====
    async function showFormStep3() {
      state.currentStep = 3;
      if (elCreateFormStep2) elCreateFormStep2.style.display = 'none';
      if (elCreateFormStep3) elCreateFormStep3.style.display = 'block';
      if (elBackBtn) elBackBtn.style.display = 'inline-block'; // Mostrar botão Voltar na etapa 3

      // Limpar lista
      if (elUserTypeList) {
        elUserTypeList.innerHTML = '<div class="ug-loading">Carregando tipos de perfil...</div>';
      }

      // Unidades selecionadas na etapa 2
      const selectedIds = Array.from(state.selectedGrandchildren);
      
      if (selectedIds.length === 0) {
        if (elUserTypeList) {
          elUserTypeList.innerHTML = '<div class="ug-empty">Nenhuma unidade selecionada.</div>';
        }
        return;
      }

      // Montar caminho raiz -> nó para cada unidade selecionada
      function buildPathToRoot(customerId) {
        const path = [];
        let current = customerId;
        while (current) {
          const c = state.index.get(current);
          if (!c) break;
          path.unshift(c); // raiz -> folha
          current = state.parentMap.get(current);
        }
        return path;
      }

      // Encontrar o LCA (Lowest Common Ancestor) a partir dos caminhos
      function findLCAFromPaths(paths) {
        if (!paths.length) return null;
        if (paths.length === 1) {
          return paths[0][paths[0].length - 1] || null;
        }

        const minLen = Math.min(...paths.map(p => p.length));
        let lca = null;

        for (let i = 0; i < minLen; i++) {
          const nodeId = paths[0][i]?.id?.id;
          if (!nodeId) break;

          const allMatch = paths.every(p => p[i]?.id?.id === nodeId);
          if (!allMatch) {
            break;
          }
          lca = paths[0][i];
        }

        return lca;
      }

      const paths = selectedIds
        .map(id => buildPathToRoot(id))
        .filter(p => p && p.length > 0);

      if (!paths.length) {
        if (elUserTypeList) {
          elUserTypeList.innerHTML = '<div class="ug-empty">Não foi possível montar o caminho das unidades selecionadas.</div>';
        }
        return;
      }

      const lcaCustomer = findLCAFromPaths(paths);

      if (!lcaCustomer || !lcaCustomer.id || !lcaCustomer.id.id) {
        if (elUserTypeList) {
          elUserTypeList.innerHTML = '<div class="ug-empty">Não foi possível determinar o ancestral comum das unidades selecionadas.</div>';
        }
        return;
      }

      const lcaId = lcaCustomer.id.id;
      const lcaTitle = lcaCustomer.title || 'Sem nome';

      console.log('showFormStep3 - selectedIds:', selectedIds);
      console.log('showFormStep3 - LCA (ancestral comum):', lcaId, lcaTitle);

      // Buscar o SpecialCustomer dentro da subárvore do LCA
      async function getClientType(id) {
        let cached = state.clientTypesCache.get(id);
        if (cached === undefined) {
          cached = await fetchCustomerClientType(id);
          state.clientTypesCache.set(id, cached || null);
        }
        return (cached || '').toString();
      }

      async function findSpecialCustomerInSubtree(rootCustomerId) {
        const queue = [rootCustomerId];
        const visited = new Set();

        while (queue.length > 0) {
          const currentId = queue.shift();
          if (!currentId || visited.has(currentId)) continue;
          visited.add(currentId);

          const type = (await getClientType(currentId)).toLowerCase();
          if (type === 'specialcustomer') {
            return currentId;
          }

          const children = getChildren(currentId) || [];
          children.forEach(child => {
            const cid = child?.id?.id;
            if (cid && !visited.has(cid)) {
              queue.push(cid);
            }
          });
        }

        return null;
      }

      const specialCustomerId = await findSpecialCustomerInSubtree(lcaId);

      if (!specialCustomerId) {
        if (elUserTypeList) {
          elUserTypeList.innerHTML = '<div class="ug-empty">Não foi possível localizar um SpecialCustomer no ancestral comum.</div>';
        }
        return;
      }

      const specialCustomerTitle = state.index.get(specialCustomerId)?.title || 'Sem nome';
      console.log('showFormStep3 - SpecialCustomer encontrado:', specialCustomerId, specialCustomerTitle);

      // Para etapa 3: buscar templates no SpecialCustomer (filho do LCA)
      state.rootId = specialCustomerId;

      // Buscar grupos de usuário do SpecialCustomer
      const userGroups = await fetchUserGroupsOfParent(specialCustomerId);
      
      // Filtrar grupos: deve ter 'entityGroupTemplate' E NÃO deve ter 'GroupCustomized'
      const filteredGroups = [];
      for (const group of userGroups) {
        const groupId = group.id?.id || group.id;
        if (!groupId) continue;
        
        try {
          const attributes = await fetchGroupAttributes(groupId);
          
          // Verificar se tem 'entityGroupTemplate'
          const hasTemplate = attributes.some(attr => attr.key === 'entityGroupTemplate');
          
          // Verificar se NÃO tem 'GroupCustomized'
          const hasCustomized = attributes.some(attr => attr.key === 'GroupCustomized');
          
          // Incluir apenas se tem template E não tem customized
          if (hasTemplate && !hasCustomized) {
            filteredGroups.push(group);
          }
        } catch (e) {
          // Silent error when fetching group attributes
        }
      }
      
      if (elUserTypeList) {
        elUserTypeList.innerHTML = '';
        if (filteredGroups.length === 0) {
          elUserTypeList.innerHTML = '<div class="ug-empty">Nenhum template de perfil encontrado.</div>';
        } else {
          filteredGroups.forEach(group => {
            const btn = document.createElement('button');
            btn.className = 'ug-user-type-btn';
            btn.textContent = group.name;
            btn.addEventListener('click', () => {
              state.selectedUserTypeGroup = group;
              showFormStep4();
            });
            elUserTypeList.appendChild(btn);
          });
        }
      }
    }

    function backToStep2() {
      state.currentStep = 2;
      if (elCreateFormStep3) elCreateFormStep3.style.display = 'none';
      if (elCreateFormStep2) elCreateFormStep2.style.display = 'block';
    }

  // ===== Etapa 4: Confirmação final e cópia das regras =====
  async function showFormStep4() {
    state.currentStep = 4;
    if (elCreateFormStep3) elCreateFormStep3.style.display = 'none';
    if (elCreateFormStep4) elCreateFormStep4.style.display = 'block';
    if (elBackBtn) elBackBtn.style.display = 'inline-block'; // Mostrar botão Voltar na etapa 4
    
    // Atualizar resumo final
    const groupName = elGroupName?.value?.trim();
    const selectedUserTypeGroup = state.selectedUserTypeGroup;
    
    if (selectedUserTypeGroup) {
      // Extrair prefixo do nome do template
      const words = selectedUserTypeGroup.name.split(' ');
      let prefix = words[0];
      // Se a segunda palavra for "Manager", incluir também
      if (words.length > 1 && words[1] === 'Manager') {
        prefix = `${words[0]} ${words[1]}`;
      }
      const finalName = `${prefix} - ${groupName}`;
      
      document.getElementById('ug-final-name').textContent = finalName;
      document.getElementById('ug-final-type').textContent = selectedUserTypeGroup.name;
    } else {
      document.getElementById('ug-final-name').textContent = groupName;
      document.getElementById('ug-final-type').textContent = 'Nenhum (sem cópia de regras)';
    }
    
    document.getElementById('ug-final-units').textContent = state.selectedGrandchildren.size;
    
    const scopes = {
      customers: elScopeCustomers?.checked || false,
      devices: elScopeDevices?.checked || false,
      assets: elScopeAssets?.checked || false
    };
    const scopesSelected = [scopes.customers, scopes.devices, scopes.assets].filter(Boolean).length;
    const rolesCount = state.selectedGrandchildren.size * scopesSelected;
    document.getElementById('ug-final-perms').textContent = rolesCount;
  }
  
  function backToStep3() {
    state.currentStep = 3;
    if (elCreateFormStep4) elCreateFormStep4.style.display = 'none';
    if (elCreateFormStep3) elCreateFormStep3.style.display = 'block';
  }  // Shared form elements
  const elGroupName = document.getElementById('ug-group-name');
  const elOwnerName = document.getElementById('ug-owner-name');
  const elScopeCustomers = document.getElementById('ug-scope-customers');
  const elScopeDevices = document.getElementById('ug-scope-devices');
  const elScopeAssets = document.getElementById('ug-scope-assets');
  const elHierarchyTree = document.getElementById('ug-hierarchy-tree');
  const elSelectAll = document.getElementById('ug-select-all');
  const elDeselectAll = document.getElementById('ug-deselect-all');
  const elSummaryCount = document.getElementById('ug-summary-count');
  const elSummaryRoles = document.getElementById('ug-summary-roles');

  // ==== Raiz (Settings > usuário) ====
  const isTenant = ctx.currentUser?.authority === 'TENANT_ADMIN';

  let configuredRoot =
    (ctx.settings && ctx.settings.rootCustomerId && String(ctx.settings.rootCustomerId).trim()) ||
    (!isTenant && ctx.currentUser && ctx.currentUser.customerId && (
      typeof ctx.currentUser.customerId === 'string'
        ? ctx.currentUser.customerId
        : ctx.currentUser.customerId.id
    )) ||
    null;

  const state = {
    rootId: null, // PAI escolhido (não mais avô)
    selectedCustomer: null,
    customers: [],
    childrenMap: new Map(),
    clientTypesCache: new Map(), // Cache de clientType por customerId
    index: new Map(),
    parentMap: new Map(),
    filterText: '',
    filterTerm: '',
    filterUnitsText: '',
    filterUnitsTerm: '',
    collapsedNodes: new Set(),
    formOpen: false,
    currentStep: 1,
    // Dados para criação do grupo
    selectedGrandchildren: new Set(), // IDs dos filhos/netos selecionados
    childrenData: new Map(), // Map de parentId -> {customer, children: []}
    selectedParentId: null, // PAI de origem escolhido
    ownChildrenIds: new Set(), // Filhos do PAI de origem (sempre marcados)
    // Pré-seleção vinda do wizard anterior
    preselectedCustomerIds: new Set(preselectedCustomerIds),
  };

  const FILTER_DEBOUNCE_MS = 200;

  // ===== Utils =====
  const compareCustomers = (a, b) =>
    (a?.title || '').localeCompare(b?.title || '', undefined, { sensitivity: 'base', numeric: true });
  const normalizeText = (value) => (value || '').toString().trim().toLowerCase();

  function logErr(msg, err) {
    // Silent error logging removed
  }

  // ===== HTTP helpers =====
  function GET(url) {
    if (!ctx || !ctx.http || typeof ctx.http.get !== 'function') {
      throw new Error('ctx.http.get não está disponível');
    }
    return ctx.http.get(url).toPromise();
  }

  function POST(url, body) {
    if (!ctx || !ctx.http || typeof ctx.http.post !== 'function') {
      throw new Error('ctx.http.post não está disponível');
    }
    return ctx.http.post(url, body).toPromise();
  }

  // ===== Status =====
  function setStatus(msg, type = 'info') {
    if (!elStatus) return;
    elStatus.textContent = msg;
    elStatus.className = 'ug-status ' + type;
  }

  function busy(btn, isBusy, text = 'Processando...') {
    if (!btn) return;
    if (isBusy) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = text;
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  // ===== API Calls =====
  async function fetchAllCustomers() {
    setStatus('fetchAllCustomers chamado...', 'info');
    const pageSize = 15000;
    let page = 0;
    let out = [];

    // Tenta primeiro o endpoint customerInfos/all (mais compatível)
    let useCustomerInfos = true;

    while (true) {
      let res;
      try {
        if (useCustomerInfos) {
          res = await GET(
            `/api/customerInfos/all?pageSize=${pageSize}&page=${page}&sortProperty=title&sortOrder=ASC&includeCustomers=true`
          );
        } else {
          res = await GET(
            `/api/customers?pageSize=${pageSize}&page=${page}&sortProperty=title&sortOrder=ASC`
          );
        }
      } catch (e) {
        // Se falhar no primeiro endpoint e for a primeira tentativa, tenta o fallback
        if (useCustomerInfos && page === 0) {
          useCustomerInfos = false;
          continue;
        }

        const endpoint = useCustomerInfos ? '/api/customerInfos/all' : '/api/customers';
        logErr(`Falha em GET ${endpoint}`, e);
        throw e;
      }

      // Padroniza o formato de PageData
      let pageData = [];
      if (Array.isArray(res?.data)) pageData = res.data;
      else if (Array.isArray(res?.data?.data)) pageData = res.data.data;

      out = out.concat(pageData);
      const hasNext = Boolean(
        res?.data && typeof res.data.hasNext !== 'undefined' ? res.data.hasNext : false
      );
      if (!hasNext) break;
      page++;
    }

    // Se temos um rootId configurado e ele não está na lista, buscar explicitamente
    const isTenantWithoutCustomer = ctx.currentUser?.authority === 'TENANT_ADMIN' && !ctx.currentUser?.customerId;

    if (configuredRoot && !isTenantWithoutCustomer && !out.some(c => c?.id?.id === configuredRoot)) {
      try {
        const response = await GET(`/api/customer/${configuredRoot}`);
        const rootCustomer = response?.data || response;

        if (rootCustomer && rootCustomer.id) {
          out.unshift(rootCustomer);
        }
      } catch (e) {
        logErr(`Erro ao buscar customer raiz ${configuredRoot}`, e);
      }
    }

    setStatus('fetchAllCustomers terminou.', 'info');
    return out;
  }


  async function createUserGroup(ownerId, groupName) {
    try {
      // Se o tipo de usuário foi selecionado, copiar regras e ajustar nome
      let finalName = groupName;
      let config = { columns: [], settings: {}, actions: {} };
      let additionalInfo = {
        description: 'Grupo criado automaticamente com permissões granulares.',
        createdBy: 'Widget GruposUsuariosAutomatizado',
        createdAt: new Date().toISOString()
      };
      if (state.selectedUserTypeGroup) {
        // Ajustar nome: extrair prefixo do template + " - " + nome definido na tela 2
        const words = state.selectedUserTypeGroup.name.split(' ');
        let prefix = words[0];
        // Se a segunda palavra for "Manager", incluir também
        if (words.length > 1 && words[1] === 'Manager') {
          prefix = `${words[0]} ${words[1]}`;
        }
        finalName = `${prefix} - ${groupName}`;
        // Copiar regras/configuração
        if (state.selectedUserTypeGroup.configuration) {
          config = JSON.parse(JSON.stringify(state.selectedUserTypeGroup.configuration));
        }
        // Copiar additionalInfo se necessário
        if (state.selectedUserTypeGroup.additionalInfo) {
          additionalInfo = Object.assign({}, additionalInfo, state.selectedUserTypeGroup.additionalInfo);
        }
      }
      const payload = {
        name: finalName,
        type: 'USER',
        ownerId: {
          id: ownerId,
          entityType: 'CUSTOMER'
        },
        groupAll: false,
        edgeGroupAll: false,
        additionalInfo,
        configuration: config
      };
      const res = await POST('/api/entityGroup', payload);
      return res?.data || res;
    } catch (e) {
      logErr('Erro ao criar grupo de usuários', e);
      throw e;
    }
  }

  // =====================================================================
  // MAPEAR SCOPES PARA ROLE IDS
  // =====================================================================
  // IMPORTANTE: Ajustar os IDs das roles conforme seu ambiente ThingsBoard
  // Para descobrir os IDs corretos:
  // 1. Acesse ThingsBoard → Security → Roles
  // 2. Inspecione a chamada de rede ao clicar em uma role
  // 3. Copie o ID da role desejada
  // =====================================================================
  const ROLE_IDS = {
    customers: '2a3fc390-3891-11ef-92dd-bda2981970d2', // Role de APENAS LEITURA para customers
    devices: '2a3fc390-3891-11ef-92dd-bda2981970d2',   // Role de APENAS LEITURA para devices (ajustar se necessário)
    assets: '2a3fc390-3891-11ef-92dd-bda2981970d2'     // Role de APENAS LEITURA para assets (ajustar se necessário)
  };
  // =====================================================================

  async function createEntityGroup(ownerId, entityType, entityIds, groupName) {
    try {
      // 1. Criar o entityGroup vazio
      const payload = {
        name: groupName,
        type: entityType,
        ownerId: {
          id: ownerId,
          entityType: 'CUSTOMER'
        },
        groupAll: false,
        edgeGroupAll: false
      };
      
      const res = await POST('/api/entityGroup', payload);
      const group = res?.data || res;
      const groupId = group?.id?.id || group?.id;
      
      if (!groupId) {
        throw new Error('Falha ao obter ID do grupo criado');
      }
      
      // 2. Adicionar as entidades ao grupo
      const addEntitiesUrl = `/api/entityGroup/${groupId}/addEntities`;
      const entitiesPayload = entityIds; // Array simples de UUIDs
      
      await POST(addEntitiesUrl, entitiesPayload);
      
      return group;
    } catch (e) {
      logErr(`Erro ao criar entity group de ${entityType}`, e);
      throw e;
    }
  }

  async function createGroupPermission(userGroupId, roleId, entityGroupId, entityGroupOwnerId) {
    try {
      const payload = {
        userGroupId: {
          entityType: 'ENTITY_GROUP',
          id: userGroupId
        },
        entityGroupId: {
          entityType: 'ENTITY_GROUP',
          id: entityGroupId
        },
        entityGroupOwnerId: {
          entityType: 'CUSTOMER',
          id: entityGroupOwnerId
        },
        role: {
          type: 'GROUP',
          id: {
            entityType: 'ROLE',
            id: roleId
          }
        },
        roleId: {
          entityType: 'ROLE',
          id: roleId
        },
        entityType: 'ENTITY_GROUP',
        userGroupOwnerId: null
      };
      
      const res = await POST('/api/groupPermission', payload);
      return res?.data || res;
    } catch (e) {
      logErr('Erro ao criar permissão de grupo', e);
      throw e;
    }
  }

  async function getEntityGroupAll(customerId, groupType) {
    try {
      const url = `/api/entityGroupInfos/CUSTOMER/${customerId}/${groupType}?pageSize=50&page=0&textSearch=All&sortProperty=name&sortOrder=ASC`;
      const res = await GET(url);
      
      let groups = [];
      if (Array.isArray(res)) {
        groups = res;
      } else if (res?.data && Array.isArray(res.data)) {
        groups = res.data;
      } else if (res?.data?.data && Array.isArray(res.data.data)) {
        groups = res.data.data;
      }
      
      // Buscar o grupo "All" (deve ser exato)
      const allGroup = groups.find(g => g.name === 'All');
      
      return allGroup;
    } catch (e) {
      // Se for 404, pode ser que o customer não tenha grupos desse tipo ainda
      if (e?.status === 404 || e?.error?.status === 404) {
        return null;
      }
      throw e;
    }
  }

  async function createGroupPermissions(userGroupId, selectedGrandchildren, scopes) {
    const permissions = [];
    const errors = [];

    // Filtrar apenas os IDs que NÃO são locked (excluir PAI e seus descendentes diretos)
    const selectedArray = Array.from(selectedGrandchildren).filter(id => !state.ownChildrenIds.has(id));

    // Criar permissões para cada escopo selecionado
    if (scopes.customers) {
      try {
        // Agrupar customers selecionados pelo owner direto deles
        const customersByOwner = new Map();
        
        for (const customerId of selectedArray) {
          const customer = state.index.get(customerId);
          if (!customer) continue;
          
          // Obter o owner direto (pai) do customer
          const ownerId = state.parentMap.get(customerId);
          if (!ownerId) continue;
          
          if (!customersByOwner.has(ownerId)) {
            customersByOwner.set(ownerId, []);
          }
          customersByOwner.get(ownerId).push(customerId);
        }
        
        // Para cada owner direto, criar um entityGroup separado
        const groupName = document.getElementById('ug-group-name')?.value?.trim();
        let groupIndex = 1;
        
        for (const [ownerId, customerIds] of customersByOwner.entries()) {
          try {
            const ownerCustomer = state.index.get(ownerId);
            const ownerName = ownerCustomer?.title || ownerId;
            const entityGroupName = customersByOwner.size > 1 
              ? `${groupName} - ${ownerName}` 
              : groupName;
            
            // Criar entityGroup neste owner específico
            const customersGroup = await createEntityGroup(
              ownerId,
              'CUSTOMER',
              customerIds,
              entityGroupName
            );
            
            const entityGroupId = customersGroup?.id?.id || customersGroup?.id;
            if (entityGroupId) {
              // Criar permissão apontando para este owner
              const perm = await createGroupPermission(
                userGroupId,
                ROLE_IDS.customers,
                entityGroupId,
                ownerId
              );
              permissions.push(perm);
            }
            
            groupIndex++;
          } catch (e) {
            errors.push({ scope: 'customers', ownerId, error: e });
          }
        }
      } catch (e) {
        errors.push({ scope: 'customers', error: e });
      }
    }

    if (scopes.devices) {
      // Para cada unidade selecionada, buscar o grupo "All" de DEVICE e criar permissão
      for (const customerId of selectedArray) {
        try {
          const allGroup = await getEntityGroupAll(customerId, 'DEVICE');
          
          if (!allGroup) {
            errors.push({ 
              scope: 'devices', 
              customerId, 
              error: new Error(`Grupo "All" de DEVICE não encontrado para customer ${customerId}`) 
            });
            continue;
          }
          
          const entityGroupId = allGroup.id?.id || allGroup.id;
          
          if (entityGroupId) {
            const perm = await createGroupPermission(
              userGroupId,
              ROLE_IDS.devices,
              entityGroupId,
              customerId
            );
            permissions.push(perm);
          }
        } catch (e) {
          errors.push({ scope: 'devices', customerId, error: e });
        }
      }
    }

    if (scopes.assets) {
      // Para cada unidade selecionada, buscar o grupo "All" de ASSET e criar permissão
      for (const customerId of selectedArray) {
        try {
          const allGroup = await getEntityGroupAll(customerId, 'ASSET');
          
          if (!allGroup) {
            errors.push({ 
              scope: 'assets', 
              customerId, 
              error: new Error(`Grupo "All" de ASSET não encontrado para customer ${customerId}`) 
            });
            continue;
          }
          
          const entityGroupId = allGroup.id?.id || allGroup.id;
          
          if (entityGroupId) {
            const perm = await createGroupPermission(
              userGroupId,
              ROLE_IDS.assets,
              entityGroupId,
              customerId
            );
            permissions.push(perm);
          }
        } catch (e) {
          errors.push({ scope: 'assets', customerId, error: e });
        }
      }
    }

    return { permissions, errors };
  }

  // ===== Indexing =====
  function buildIndexes(list) {
    state.customers = list;
    state.childrenMap.clear();
    state.index.clear();
    state.parentMap.clear();

    // Primeiro pass: indexar todos os customers
    list.forEach((c) => {
      const id = c?.id?.id;
      if (id) {
        state.index.set(id, c);
      }
    });

    // Segundo pass: construir hierarquia
    list.forEach((c) => {
      const id = c?.id?.id;
      let parentId = c?.parentId?.id || c?.parentCustomerId?.id;

      if (parentId && !state.index.has(parentId)) {
        parentId = null;
      }

      if (id) {
        state.parentMap.set(id, parentId || null);
      }
      if (parentId) {
        if (!state.childrenMap.has(parentId)) state.childrenMap.set(parentId, []);
        state.childrenMap.get(parentId).push(c);
      }
    });

    state.childrenMap.forEach((kids) => kids.sort(compareCustomers));

    // Adicionar todos os parents ao collapsedNodes para que apareçam fechados por padrão
    state.childrenMap.forEach((_, parentId) => {
      state.collapsedNodes.add(parentId);
    });

    const pruneSet = (set) => {
      if (!set || typeof set.forEach !== 'function') {
        return;
      }
      const items = Array.from(set);
      items.forEach((id) => {
        if (!state.index.has(id)) {
          set.delete(id);
        }
      });
    };
    pruneSet(state.collapsedNodes);

    if (state.rootId && !state.index.has(state.rootId)) {
      state.rootId = null;
    }
  }

  // ===== Helpers =====
  function getChildren(customerId) {
    return state.childrenMap.get(customerId) || [];
  }

  function isNodeCollapsed(id) {
    return state.collapsedNodes.has(id);
  }

  function toggleNodeCollapsed(id, context = 'selection') {
    if (state.collapsedNodes.has(id)) {
      state.collapsedNodes.delete(id);
    } else {
      state.collapsedNodes.add(id);
    }

    // Re-renderiza a árvore da hierarquia (árvore principal foi removida)
    renderHierarchyTree();
  }

  function toggleNodeCollapsedInHierarchy(id) {
    if (state.collapsedNodes.has(id)) {
      state.collapsedNodes.delete(id);
    } else {
      state.collapsedNodes.add(id);
    }
    renderHierarchyTree();
  }

  function nodeMatchesFilter(customer) {
    if (!state.filterTerm) return true;
    const title = normalizeText(customer?.title || '');
    return title.includes(state.filterTerm);
  }

  function nodeMatchesFilterUnits(customer) {
    if (!state.filterUnitsTerm) return true;
    const title = normalizeText(customer?.title || '');
    return title.includes(state.filterUnitsTerm);
  }

  function nodeOrDescendantsMatchFilter(customer) {
    if (!state.filterUnitsTerm) return true;
    if (nodeMatchesFilterUnits(customer)) return true;
    
    const children = getChildren(customer?.id?.id);
    return children.some(child => nodeOrDescendantsMatchFilter(child));
  }

  function getPathLabel(customerId) {
    const parts = [];
    let current = customerId;
    while (current) {
      const c = state.index.get(current);
      if (c) parts.unshift(c.title);
      current = state.parentMap.get(current);
    }
    return parts.join(' > ');
  }

  // ===== Rendering (árvore de seleção de root foi removida) =====

  function renderNode(customer, context = 'main', options = {}, level = 0) {
    const id = customer?.id?.id;
    if (!id) return null;

    const children = getChildren(id);
    const hasChildren = Boolean(children && children.length);
    const forceExpand = Boolean(state.filterTerm);
    const collapsed = hasChildren && !forceExpand && isNodeCollapsed(id, context);

    let matchesSelf = true;
    matchesSelf = nodeMatchesFilter(customer);
    if (state.filterTerm && !matchesSelf && !hasChildren && !options.forceVisible) {
      return null;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ug-node';
    wrap.dataset.customerId = id;
    wrap.dataset.level = level;
    if (options.isRoot) {
      wrap.classList.add('ug-root');
    }
    if (collapsed) {
      wrap.dataset.collapsed = 'true';
    }

    const header = nodeHeader(customer, {
      context,
      highlight: matchesSelf && Boolean(state.filterTerm),
      hasChildren,
      collapsed,
      isRoot: Boolean(options.isRoot),
      selected: state.rootId === id,
      onToggle: hasChildren
        ? () => {
          toggleNodeCollapsed(id, context);
        }
        : null,
      onSelect: null // Não permite seleção na view principal
    }, level);
    wrap.appendChild(header);

    if (hasChildren && (!collapsed || forceExpand)) {
      children.forEach((child) => {
        const childEl = renderNode(child, context, {}, level + 1);
        if (childEl) wrap.appendChild(childEl);
      });
    }

    return wrap;
  }

  function nodeHeader(customer, opts = {}, level = 0) {
    const line = document.createElement('div');
    line.className = 'ug-node-header';
    if (opts.selected) line.classList.add('selected');

    // Toggle minimalista à esquerda
    if (opts.hasChildren && opts.onToggle) {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'ug-toggle';
      toggleBtn.setAttribute('aria-label', opts.collapsed ? 'Expandir' : 'Recolher');
      toggleBtn.innerHTML = opts.collapsed ? '&#9654;' : '&#9660;';
      toggleBtn.style.background = 'none';
      toggleBtn.style.border = 'none';
      toggleBtn.style.padding = '0 4px 0 0';
      toggleBtn.style.marginRight = '4px';
      toggleBtn.style.fontSize = '13px';
      toggleBtn.style.color = '#f0830f';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggle();
      });
      line.appendChild(toggleBtn);
    } else {
      const empty = document.createElement('span');
      empty.style.display = 'inline-block';
      empty.style.width = '16px';
      line.appendChild(empty);
    }

    // Bolinha laranja (indicator)
    const indicator = document.createElement('span');
    indicator.className = 'ug-root-indicator';
    if (opts.selected) indicator.classList.add('selected');
    line.appendChild(indicator);

    // Título
    const titleSpan = document.createElement('span');
    titleSpan.className = 'ug-hierarchy-title';
    titleSpan.textContent = customer?.title || '(sem nome)';
    line.appendChild(titleSpan);

    // Etiqueta do clientType (buscar do cache ou carregar)
    const customerId = customer?.id?.id;

    if (customerId) {
      const cached = state.clientTypesCache.get(customerId);

      if (cached !== undefined) {
        const clientType = cached;
        const normalized = (clientType || '').toLowerCase();

        const isStructural = normalized === 'structural';
        const isSpecial = normalized === 'specialcustomer';

        // Ocultar apenas a LINHA do SpecialCustomer (filhos continuam visíveis)
        if (isSpecial) {
          line.classList.add('hidden-special');
        }

        // Somente structural pode ser clicável
        if (!isStructural) {
          line.classList.add('non-structural');
        }

        // Badge
        if (clientType) {
          const typeChip = document.createElement('span');
          typeChip.className = 'ug-chip ug-chip-type';
          typeChip.textContent = clientType;
          typeChip.style.marginLeft = 'auto';
          line.appendChild(typeChip);
        }

      } else {
        // Ainda não buscado → buscar agora
        state.clientTypesCache.set(customerId, null);

        fetchCustomerClientType(customerId).then(type => {
          // Guarda o valor original (comparação usa lowercase via normalized)
          state.clientTypesCache.set(customerId, type || null);
          // Árvore principal não existe mais, não há re-render
        });
      }
    }

    // Chips de grupo/origem
    if (customer && customer.additionalInfo && customer.additionalInfo.type) {
      const chip = document.createElement('span');
      chip.className = 'ug-chip';
      chip.textContent = customer.additionalInfo.type;
      line.appendChild(chip);
    }
    if (customer && customer.additionalInfo && customer.additionalInfo.groups) {
      customer.additionalInfo.groups.forEach(grp => {
        const chip = document.createElement('span');
        chip.className = 'ug-chip ug-chip-group';
        chip.textContent = grp;
        line.appendChild(chip);
      });
    }

    // Clique ativa o nó (apenas se tiver onSelect)
    if (opts.onSelect) {
      line.style.cursor = 'pointer';
      line.addEventListener('click', (e) => {
        // Não processar se clicou no botão de toggle
        if (e.target.closest('.ug-toggle')) {
          return;
        }
        
        document.querySelectorAll('.ug-node-header.selected').forEach(el => el.classList.remove('selected'));
        document.querySelectorAll('.ug-root-indicator.selected').forEach(el => el.classList.remove('selected'));
        line.classList.add('selected');
        indicator.classList.add('selected');
        opts.onSelect();
      });
    } else {
      line.style.cursor = 'default';
    }

    return line;
  }

  // ===== Form =====
  function showFormStep1() {
    state.formOpen = true;
    state.currentStep = 1;

    // Ocultar outras etapas e mostrar etapa 1
    if (elCreateFormStep1) elCreateFormStep1.style.display = 'block';
    if (elCreateFormStep2) elCreateFormStep2.style.display = 'none';
    if (elCreateFormStep3) elCreateFormStep3.style.display = 'none';
    if (elCreateFormStep4) elCreateFormStep4.style.display = 'none';
    if (elBackBtn) elBackBtn.style.display = 'none'; // Não mostrar "Voltar" na etapa 1

    // Limpar campo de nome se necessário
    if (elGroupName && !elGroupName.value) {
      elGroupName.value = '';
    }
  }

  function showFormStep2() {
    // Validar etapa 1
    const groupName = elGroupName?.value?.trim();
    if (!groupName) {
      setStatus('Por favor, informe o nome do perfil.', 'error');
      return;
    }

    const scopes = {
      customers: elScopeCustomers?.checked || false,
      devices: elScopeDevices?.checked || false,
      assets: elScopeAssets?.checked || false
    };

    if (!scopes.customers && !scopes.devices && !scopes.assets) {
      setStatus('Selecione pelo menos um escopo de permissões.', 'error');
      return;
    }

    state.currentStep = 2;

    // Alternar para etapa 2
    if (elCreateFormStep1) elCreateFormStep1.style.display = 'none';
    if (elCreateFormStep2) elCreateFormStep2.style.display = 'block';
    if (elBackBtn) elBackBtn.style.display = 'inline-block'; // Mostrar botão Voltar na etapa 2

    // Limpar seleções anteriores
    state.selectedGrandchildren.clear();
    state.childrenData.clear();

    // Carregar hierarquia
    loadHierarchyForModal();
  }

  // Avançar para etapa 3 após seleção de unidades
  function nextToStep3() {
    // Validar se há unidades selecionadas
    if (state.selectedGrandchildren.size === 0) {
      setStatus('Por favor, selecione pelo menos uma unidade.', 'error');
      return;
    }
    
    showFormStep3();
  }

  function backToStep1() {
    state.currentStep = 1;
    
    if (elCreateFormStep2) elCreateFormStep2.style.display = 'none';
    if (elCreateFormStep1) elCreateFormStep1.style.display = 'block';
    if (elBackBtn) elBackBtn.style.display = 'none'; // Ocultar botão Voltar ao retornar para etapa 1
  }

  function hideForm() {
    state.formOpen = false;
    state.currentStep = 1;

    // Ocultar formulários
    if (elCreateFormStep1) elCreateFormStep1.style.display = 'none';
    if (elCreateFormStep2) elCreateFormStep2.style.display = 'none';
    if (elCreateFormStep3) elCreateFormStep3.style.display = 'none';
    if (elCreateFormStep4) elCreateFormStep4.style.display = 'none';
    
    // Ocultar seção de resumo
    const elSummarySection = document.getElementById('ug-summary-section');
    if (elSummarySection) elSummarySection.style.display = 'none';
    
    if (elBackBtn) elBackBtn.style.display = 'none';
    elRootLabel.textContent = '';

    // Limpar campos
    if (elGroupName) elGroupName.value = '';
    state.selectedGrandchildren.clear();
    state.childrenData.clear();
    state.ownChildrenIds.clear();
    state.selectedUserTypeGroup = null;
    state.rootId = null;
    state.selectedParentId = null;
  }

  async function loadHierarchyForModal() {
    if (!elHierarchyTree) return;

    elHierarchyTree.innerHTML = '<div class="ug-loading">Carregando hierarquia...</div>';

    try {
      // Limpar dados anteriores (não há mais PAI fixo bloqueado)
      state.ownChildrenIds.clear();
      state.childrenData.clear();

      // Pré-carregar clientTypes de todos os customers para garantir filtragem correta
      const loadPromises = state.customers.map(async (customer) => {
        const id = customer?.id?.id;
        if (id && !state.clientTypesCache.has(id)) {
          const clientType = await fetchCustomerClientType(id);
          state.clientTypesCache.set(id, clientType || null);
        }
      });

      await Promise.all(loadPromises);

      // Função recursiva para processar toda a hierarquia
      function processHierarchy(customerId) {
        const children = getChildren(customerId);

        if (children.length > 0) {
          state.childrenData.set(customerId, {
            customer: state.index.get(customerId),
            children: children,
            isOwnParent: false
          });

          // Processar recursivamente os filhos
          children.forEach(child => {
            processHierarchy(child.id.id);
          });
        }
      }

      // Buscar a raiz da hierarquia (top-level customers)
      const topLevel = state.customers.filter((c) => {
        const parentId = state.parentMap.get(c?.id?.id);
        return !parentId || !state.index.has(parentId);
      });

      // Processar toda a hierarquia a partir dos top-level
      topLevel.forEach(customer => {
        processHierarchy(customer.id.id);
      });

      // Renderizar árvore hierárquica
      renderHierarchyTree();

      // Aplicar pré-seleção vinda do wizard, se houver
      applyPreselectionFromWizard();

    } catch (e) {
      logErr('Erro ao carregar hierarquia', e);
      elHierarchyTree.innerHTML = '<div class="ug-empty">Erro ao carregar hierarquia.</div>';
    }
  }

  function applyPreselectionFromWizard() {
    console.log('🔍 [PRÉ-SELEÇÃO] Iniciando aplicação de pré-seleção do wizard');
    console.log('🔍 [PRÉ-SELEÇÃO] IDs recebidos:', Array.from(state.preselectedCustomerIds || []));
    console.log('🔍 [PRÉ-SELEÇÃO] Total de IDs no state.index:', state.index.size);
    
    if (!state.preselectedCustomerIds || state.preselectedCustomerIds.size === 0) {
      console.log('⚠️ [PRÉ-SELEÇÃO] Nenhum ID para pré-selecionar');
      return;
    }

    let foundCount = 0;
    let notFoundCount = 0;
    
    state.preselectedCustomerIds.forEach(id => {
      if (state.index.has(id)) {
        state.selectedGrandchildren.add(id);
        foundCount++;
        console.log(`✅ [PRÉ-SELEÇÃO] ID encontrado e selecionado: ${id} - ${state.index.get(id)?.title}`);
      } else {
        notFoundCount++;
        console.warn(`❌ [PRÉ-SELEÇÃO] ID NÃO encontrado no index: ${id}`);
      }
    });

    console.log(`✅ [PRÉ-SELEÇÃO] Resumo: ${foundCount} encontrados, ${notFoundCount} não encontrados`);
    console.log(`✅ [PRÉ-SELEÇÃO] Total de selectedGrandchildren: ${state.selectedGrandchildren.size}`);

    // Limpar para não aplicar novamente em recargas futuras
    state.preselectedCustomerIds.clear();

    updateSummary();
    renderHierarchyTree();
    
    console.log('✅ [PRÉ-SELEÇÃO] Aplicação concluída');
  }

  function renderHierarchyTree() {
    if (!elHierarchyTree) return;

    elHierarchyTree.innerHTML = '';

    // Buscar todos os customers top-level
    const topLevel = state.customers.filter((c) => {
      const parentId = state.parentMap.get(c?.id?.id);
      return !parentId || !state.index.has(parentId);
    });

    if (topLevel.length === 0) {
      elHierarchyTree.innerHTML = '<div class="ug-empty">Nenhum cliente encontrado.</div>';
      return;
    }

    topLevel.sort(compareCustomers);
    
    let hasVisibleNodes = false;
    topLevel.forEach((customer) => {
      const nodeEl = renderHierarchyNode(customer, 0);
      if (nodeEl) {
        elHierarchyTree.appendChild(nodeEl);
        hasVisibleNodes = true;
      }
    });

    if (!hasVisibleNodes && state.filterUnitsTerm) {
      elHierarchyTree.innerHTML = '<div class="ug-empty">Nenhuma unidade encontrada com o filtro aplicado.</div>';
    }

    updateSummary();
  }

  function renderHierarchyNode(customer, level = 0) {
    const id = customer?.id?.id;
    if (!id) return null;

    // Verificar se é SpecialCustomer e ocultar completamente
    const cached = state.clientTypesCache.get(id);
    if (cached !== undefined && cached !== null) {
      const clientType = (cached || '').toString().toLowerCase();
      if (clientType === 'specialcustomer') {
        // Não renderizar SpecialCustomers, mas renderizar seus filhos
        const children = getChildren(id);
        const fragment = document.createDocumentFragment();
        
        children.forEach((child) => {
          const childEl = renderHierarchyNode(child, level);
          if (childEl) fragment.appendChild(childEl);
        });
        
        // Retornar fragmento com os filhos ou null se não houver filhos
        return fragment.childNodes.length > 0 ? fragment : null;
      }
    }

    const children = getChildren(id);
    const hasChildren = Boolean(children && children.length);
    const forceExpand = Boolean(state.filterUnitsTerm);
    const collapsed = hasChildren && !forceExpand && isNodeCollapsed(id);

    // Verificar se este nó ou seus descendentes correspondem ao filtro
    const matchesSelfOrDescendants = nodeOrDescendantsMatchFilter(customer);
    if (state.filterUnitsTerm && !matchesSelfOrDescendants) {
      return null;
    }

    const matchesSelf = nodeMatchesFilterUnits(customer);

    // Verificar se é filho "bloqueado" (conceito antigo de PAI de origem)
    const isOwnChild = state.ownChildrenIds.has(id);

    const wrap = document.createElement('div');
    wrap.className = 'ug-hierarchy-item';
    wrap.dataset.customerId = id;
    wrap.dataset.level = level;
    if (collapsed) {
      wrap.dataset.collapsed = 'true';
    }

    const header = createHierarchyNodeHeader(customer, {
      highlight: matchesSelf && Boolean(state.filterUnitsTerm),
      hasChildren,
      collapsed,
      selected: state.selectedGrandchildren.has(id),
      isOwnChild: isOwnChild,
      level: level, // Passar o nível para o header
      onToggle: hasChildren
        ? () => {
          toggleNodeCollapsedInHierarchy(id);
        }
        : null,
      onCheckChange: (checked) => {
        toggleChild(id, checked);
      }
    }, level);
    wrap.appendChild(header);

    // Container dos filhos
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'ug-hierarchy-children';

    if (hasChildren && (!collapsed || forceExpand)) {
      children.forEach((child) => {
        const childEl = renderHierarchyNode(child, level + 1);
        if (childEl) childrenContainer.appendChild(childEl);
      });
    }

    wrap.appendChild(childrenContainer);

    return wrap;
  }

  function createHierarchyNodeHeader(customer, opts = {}, level = 0) {
    const id = customer?.id?.id;
    const line = document.createElement('div');
    line.className = 'ug-hierarchy-header';
    
    // Não aplicar indentação no header - ela já vem do wrap
    
    // Verificar se o nó está bloqueado (PAI ou descendente do PAI)
    const isLocked = state.ownChildrenIds.has(id);
    if (isLocked) {
      line.classList.add('locked');
    }

    // Botão expandir/recolher - só mostrar se tiver filhos
    if (opts.hasChildren && opts.onToggle) {
      const expandBtn = document.createElement('button');
      expandBtn.className = 'ug-hierarchy-expand';
      expandBtn.innerHTML = opts.collapsed ? '&#9654;' : '&#9660;';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggle();
      });
      line.appendChild(expandBtn);
    } else {
      // Espaço vazio para manter alinhamento
      const expandBtn = document.createElement('span');
      expandBtn.className = 'ug-hierarchy-expand';
      expandBtn.style.visibility = 'hidden';
      line.appendChild(expandBtn);
    }

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ug-hierarchy-checkbox';
    checkbox.checked = opts.selected;
    
    if (isLocked) {
      checkbox.disabled = true;
      checkbox.title = 'PAI de origem ou descendente (sempre incluso)';
    }
    
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (opts.onCheckChange) {
        opts.onCheckChange(checkbox.checked);
      }
    });
    line.appendChild(checkbox);

    // Título
    const titleSpan = document.createElement('span');
    titleSpan.className = 'ug-hierarchy-title';
    titleSpan.textContent = customer?.title || '(sem nome)';
    
    if (opts.highlight) {
      titleSpan.style.backgroundColor = '#fff3cd';
    }
    
    line.appendChild(titleSpan);

    // Contador de filhos
    const children = getChildren(id);
    if (children.length > 0) {
      const count = document.createElement('span');
      count.className = 'ug-hierarchy-count';
      count.textContent = `(${children.length})`;
      line.appendChild(count);
    }

    // Clique no header alterna seleção (apenas se não estiver bloqueado)
    if (!isLocked) {
      line.style.cursor = 'pointer';
      line.addEventListener('click', (e) => {
        // Não processar se clicou no botão de expandir ou checkbox
        if (e.target.closest('.ug-hierarchy-expand') || e.target.closest('.ug-hierarchy-checkbox')) {
          return;
        }
        
        checkbox.checked = !checkbox.checked;
        if (opts.onCheckChange) {
          opts.onCheckChange(checkbox.checked);
        }
      });
    }

    return line;
  }

  function toggleChild(childId, select) {
    // Não permitir desmarcar filhos do PAI de origem
    if (!select && state.ownChildrenIds.has(childId)) {
      return;
    }

    if (select) {
      state.selectedGrandchildren.add(childId);
    } else {
      state.selectedGrandchildren.delete(childId);
    }

    // Aplicar seleção recursivamente a todos os descendentes (sem re-renderizar)
    toggleAllChildrenRecursive(childId, select);

    updateSummary();
    renderHierarchyTree();
  }

  function toggleAllChildrenRecursive(parentId, select) {
    const children = getChildren(parentId);
    children.forEach(child => {
      const childId = child.id.id;
      
      // Não permitir desmarcar filhos do PAI de origem
      if (!select && state.ownChildrenIds.has(childId)) {
        return;
      }
      
      if (select) {
        state.selectedGrandchildren.add(childId);
      } else {
        state.selectedGrandchildren.delete(childId);
      }
      
      // Aplicar recursivamente aos descendentes
      toggleAllChildrenRecursive(childId, select);
    });
  }

  function toggleAllChildren(parentId, select) {
    state.childrenData.forEach((data, parentId) => {
      // Não selecionar o PAI em si, apenas seus filhos
      // Selecionar todos os filhos deste PAI (se não forem locked)
      data.children.forEach(child => {
        const childId = child.id.id;
        if (!state.ownChildrenIds.has(childId)) {
          if (select) {
            state.selectedGrandchildren.add(childId);
          } else {
            state.selectedGrandchildren.delete(childId);
          }
          toggleAllChildrenRecursive(childId, select);
        }
      });
    });
    updateSummary();
    renderHierarchyTree();
  }

  function updateSummary() {
    // Contar apenas os selecionados que NÃO são locked (excluir PAI e seus descendentes)
    const countWithoutLocked = Array.from(state.selectedGrandchildren).filter(id => !state.ownChildrenIds.has(id)).length;
    
    if (elSummaryCount) {
      elSummaryCount.textContent = countWithoutLocked;
    }

    if (elSummaryRoles) {
      let rolesCount = 0;
      const scopes = {
        customers: elScopeCustomers?.checked || false,
        devices: elScopeDevices?.checked || false,
        assets: elScopeAssets?.checked || false
      };

      const scopesSelected = [scopes.customers, scopes.devices, scopes.assets].filter(Boolean).length;
      rolesCount = countWithoutLocked * scopesSelected;

      elSummaryRoles.textContent = rolesCount;
    }
  }

  // ===== Event Handlers =====
  async function handleCreateGroup() {
    const groupName = elGroupName?.value?.trim();
    
    if (!groupName) {
      setStatus('Por favor, informe o nome do perfil.', 'error');
      return;
    }

    if (state.selectedGrandchildren.size === 0) {
      setStatus('Selecione pelo menos uma unidade.', 'error');
      return;
    }

    const scopes = {
      customers: elScopeCustomers?.checked || false,
      devices: elScopeDevices?.checked || false,
      assets: elScopeAssets?.checked || false
    };

    if (!scopes.customers && !scopes.devices && !scopes.assets) {
      setStatus('Selecione pelo menos um escopo de permissões.', 'error');
      return;
    }

    busy(elModalConfirm, true, 'Criando perfil...');
    setStatus('Criando perfil de usuário...', 'info');

    try {
      // Determinar o SpecialCustomer (owner) a partir das unidades selecionadas usando LCA
      const selectedIds = Array.from(state.selectedGrandchildren);

      function buildPathToRoot(customerId) {
        const path = [];
        let current = customerId;
        while (current) {
          const c = state.index.get(current);
          if (!c) break;
          path.unshift(c); // raiz -> folha
          current = state.parentMap.get(current);
        }
        return path;
      }

      function findLCAFromPaths(paths) {
        if (!paths.length) return null;
        if (paths.length === 1) {
          return paths[0][paths[0].length - 1] || null;
        }

        let minLen = Math.min(...paths.map(p => p.length));
        let lca = null;

        for (let i = 0; i < minLen; i++) {
          const nodeId = paths[0][i]?.id?.id;
          if (!nodeId) break;

          const allMatch = paths.every(p => p[i]?.id?.id === nodeId);
          if (!allMatch) {
            break;
          }
          lca = paths[0][i];
        }

        return lca;
      }

      async function getClientType(id) {
        let cached = state.clientTypesCache.get(id);
        if (cached === undefined) {
          cached = await fetchCustomerClientType(id);
          state.clientTypesCache.set(id, cached || null);
        }
        return (cached || '').toString();
      }

      async function findSpecialCustomerInSubtree(rootCustomerId) {
        const queue = [rootCustomerId];
        const visited = new Set();

        while (queue.length > 0) {
          const currentId = queue.shift();
          if (!currentId || visited.has(currentId)) continue;
          visited.add(currentId);

          const type = (await getClientType(currentId)).toLowerCase();
          if (type === 'specialcustomer') {
            return currentId;
          }

          const children = getChildren(currentId) || [];
          children.forEach(child => {
            const cid = child?.id?.id;
            if (cid && !visited.has(cid)) {
              queue.push(cid);
            }
          });
        }

        return null;
      }

      const paths = selectedIds
        .map(id => buildPathToRoot(id))
        .filter(p => p && p.length > 0);

      const lcaCustomer = findLCAFromPaths(paths);

      if (!lcaCustomer || !lcaCustomer.id || !lcaCustomer.id.id) {
        setStatus('Não foi possível determinar o ancestral comum das unidades selecionadas.', 'error');
        busy(elModalConfirm, false);
        return;
      }

      const lcaId = lcaCustomer.id.id;
      const resolvedOwnerId = await findSpecialCustomerInSubtree(lcaId);

      if (!resolvedOwnerId) {
        setStatus('Não foi possível localizar um SpecialCustomer para as unidades selecionadas.', 'error');
        busy(elModalConfirm, false);
        return;
      }

      state.rootId = resolvedOwnerId; // reutiliza rootId como owner do grupo

      // 1. Criar o grupo de usuários
      const group = await createUserGroup(state.rootId, groupName);
      const groupId = group?.id?.id || group?.id;

      if (!groupId) {
        throw new Error('Falha ao obter ID do grupo criado');
      }

      setStatus(`Perfil criado! Criando permissões...`, 'info');

      // 2. Se um tipo de usuário foi selecionado, copiar suas permissões e atributos
      if (state.selectedUserTypeGroup) {
        const sourceGroupId = state.selectedUserTypeGroup.id?.id || state.selectedUserTypeGroup.id;
        
        const copyResult = await copyGroupPermissions(groupId, sourceGroupId);
        
        setStatus(`Permissões do tipo copiadas (${copyResult.copied}). Copiando atributos...`, 'info');
        
        // Copiar atributos
        const attrResult = await copyGroupAttributes(groupId, sourceGroupId);
        
        setStatus(`Atributos copiados (${attrResult.copied}). Criando permissões granulares...`, 'info');
      }

      // 3. Criar atributo customizado 'GroupCustomized' = true
      try {
        const customAttributeUrl = `/api/plugins/telemetry/ENTITY_GROUP/${groupId}/SERVER_SCOPE`;
        await POST(customAttributeUrl, { GroupCustomized: true });
      } catch (e) {
        // Silent error for custom attribute
      }

      // 3. Criar entity groups e permissões granulares
      const result = await createGroupPermissions(groupId, state.selectedGrandchildren, scopes);

      if (result.errors.length > 0) {
        setStatus(`Perfil criado com ${result.permissions.length} permissões. ${result.errors.length} erros.`, 'error');
      } else {
        const totalPerms = result.permissions.length + (state.selectedUserTypeGroup ? 0 : 0);
        setStatus(`Perfil criado com sucesso! ${result.permissions.length} permissões granulares configuradas.`, 'success');
      }
      
      hideForm();

      // Salvar estado antes de recarregar (owner agora é o SpecialCustomer resolvido)
      const savedRootId = state.rootId;
      const savedSelectedCount = state.selectedGrandchildren.size;
      const savedRootTitle = state.index.get(state.rootId)?.title || 'Não especificada';

      // Recarregar dados
      await loadAndRender();

      // Mostrar seção de resumo após criar o grupo
      showSummarySection(groupId, groupName, result, savedRootTitle, savedSelectedCount);

    } catch (e) {
      logErr('Erro ao criar grupo', e);
      setStatus('Erro ao criar perfil.', 'error');
    } finally {
      busy(elModalConfirm, false);
    }
  }

  async function loadAndRender() {
    setStatus('Carregando clientes...', 'info');

    try {
      const list = await fetchAllCustomers();
      buildIndexes(list);

      elRootLabel.textContent = '';
      setStatus('Clientes carregados.', 'success');

    } catch (e) {
      logErr('Erro ao carregar dados', e);
      setStatus('Erro ao carregar clientes.', 'error');
    }
  }

  // ===== Event Listeners =====

  if (elBackBtn) {
    elBackBtn.addEventListener('click', () => {
      if (state.currentStep === 4) {
        backToStep3();
      } else if (state.currentStep === 3) {
        backToStep2();
      } else if (state.currentStep === 2) {
        backToStep1();
      } else {
        hideForm();
      }
    });
  }

  // Botão de "Continuar com esta unidade" não é mais usado no novo fluxo

  if (elNextStep) {
    elNextStep.addEventListener('click', () => {
      showFormStep2();
    });
  }
  // Botão para avançar da etapa 2 para etapa 3
  if (elCreateFormStep2) {
    const btnNextStep3 = document.getElementById('next-step-3');
    if (btnNextStep3) {
      btnNextStep3.addEventListener('click', nextToStep3);
    }
  }
  // Botão para voltar da etapa 3 para etapa 2
  if (elCancelStep3) {
    elCancelStep3.addEventListener('click', backToStep2);
  }
  
  // Botão para voltar da etapa 4
  if (elCancelStep4) {
    elCancelStep4.addEventListener('click', hideForm);
  }

  // Filtro de unidades na etapa 2
  if (elFilterUnits) {
    elFilterUnits.addEventListener('input', (e) => {
      state.filterUnitsText = e.target.value;
      if (filterDebounce) clearTimeout(filterDebounce);
      filterDebounce = setTimeout(() => {
        state.filterUnitsTerm = normalizeText(state.filterUnitsText);
        renderHierarchyTree();
      }, FILTER_DEBOUNCE_MS);
    });
  }

  // Form events
  if (elCancelStep1) {
    elCancelStep1.addEventListener('click', hideForm);
  }

  if (elCancelStep2) {
    elCancelStep2.addEventListener('click', hideForm);
  }

  if (elModalConfirm) {
    elModalConfirm.addEventListener('click', handleCreateGroup);
  }

  // Scope checkboxes - atualizar resumo ao mudar
  [elScopeCustomers, elScopeDevices, elScopeAssets].forEach(checkbox => {
    if (checkbox) {
      checkbox.addEventListener('change', updateSummary);
    }
  });

  // Botões de seleção
  if (elSelectAll) {
    elSelectAll.addEventListener('click', () => {
      state.childrenData.forEach((data, parentId) => {
        // Não selecionar o PAI em si, apenas seus filhos
        // Selecionar todos os filhos deste PAI (se não forem locked)
        data.children.forEach(child => {
          const childId = child.id.id;
          if (!state.ownChildrenIds.has(childId)) {
            state.selectedGrandchildren.add(childId);
          }
        });
      });
      renderHierarchyTree();
    });
  }

  if (elDeselectAll) {
    elDeselectAll.addEventListener('click', () => {
      // Desmarcar todos EXCETO os filhos locked (próprios)
      const toKeep = new Set(state.ownChildrenIds);
      state.selectedGrandchildren.clear();
      toKeep.forEach(id => state.selectedGrandchildren.add(id));
      renderHierarchyTree();
    });
  }

  // ESC key para fechar formulário
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.formOpen) {
      hideForm();
    }
  });

  // ===== Seção de Resumo e Modal de Usuário =====
  const elSummarySection = document.getElementById('ug-summary-section');
  const elCreatedSummary = document.getElementById('ug-created-summary');
  
  console.log('Inicializando elementos do modal...');
  console.log('elSummarySection:', elSummarySection);
  
  const elCreateUserBtn = document.getElementById('ug-create-user-btn');
  const elFinishBtn = document.getElementById('ug-finish-btn');
  
  console.log('elCreateUserBtn encontrado:', elCreateUserBtn);
  console.log('elFinishBtn encontrado:', elFinishBtn);
  
  // Modal elements
  const elUserModal = document.getElementById('ug-add-user-modal');
  const elCloseUserModal = document.getElementById('ug-close-user-modal');
  const elUserModalTitle = document.getElementById('ug-user-modal-title');
  const elUserStep1 = document.getElementById('ug-user-step-1');
  const elUserStep2 = document.getElementById('ug-user-step-2');
  const elUserStep1Buttons = document.getElementById('ug-user-step-1-buttons');
  const elUserStep2Buttons = document.getElementById('ug-user-step-2-buttons');
  
  console.log('elUserModal encontrado:', elUserModal);
  console.log('elCloseUserModal encontrado:', elCloseUserModal);
  
  // Form inputs
  const elUserFirstName = document.getElementById('ug-user-firstName');
  const elUserLastName = document.getElementById('ug-user-lastName');
  const elUserEmail = document.getElementById('ug-user-email');
  const elUserPhone = document.getElementById('ug-user-phone');
  
  // Step 2 elements
  const elCreatedUserName = document.getElementById('ug-created-user-name');
  const elActivationLink = document.getElementById('ug-activation-link');
  const elCopyLinkBtn = document.getElementById('ug-copy-link-btn');
  
  // Buttons
  const elCreateUserSubmit = document.getElementById('ug-create-user-submit');
  const elCancelUser = document.getElementById('ug-cancel-user');
  const elUserFinishBtn = document.getElementById('ug-user-finish-btn');
  
  // Estado do modal de usuário
  let currentCreatedGroupId = null;
  let currentCreatedUserId = null;
  
  function showSummarySection(groupId, groupName, result, rootTitle, totalUnits) {
    currentCreatedGroupId = groupId;
    
    // Ocultar formulários anteriores
    if (elCreateFormStep4) elCreateFormStep4.style.display = 'none';
    if (elCreateFormStep3) elCreateFormStep3.style.display = 'none';
    if (elCreateFormStep2) elCreateFormStep2.style.display = 'none';
    if (elCreateFormStep1) elCreateFormStep1.style.display = 'none';
    
    // Montar resumo
    const summaryHtml = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 48px; color: #4CAF50; margin-bottom: 15px;">✓</div>
        <p style="font-size: 18px; font-weight: bold; margin: 0;">Perfil criado com sucesso!</p>
      </div>
    `;
    
    if (elCreatedSummary) {
      elCreatedSummary.innerHTML = summaryHtml;
    }
    
    // Mostrar seção de resumo
    if (elSummarySection) {
      elSummarySection.style.display = 'block';
    }
    
    if (elBackBtn) {
      elBackBtn.style.display = 'none';
    }
  }
  
  function hideSummarySection() {
    if (elSummarySection) {
      elSummarySection.style.display = 'none';
    }
    currentCreatedGroupId = null;
    currentCreatedUserId = null;
    
    // Voltar para a tela inicial
    showFormStep1();
  }
  
  function openUserModal() {
    console.log('openUserModal chamado');
    console.log('elUserModal:', elUserModal);
    
    // Reset form
    if (elUserFirstName) elUserFirstName.value = '';
    if (elUserLastName) elUserLastName.value = '';
    if (elUserEmail) elUserEmail.value = '';
    if (elUserPhone) elUserPhone.value = '';
    
    // Mostrar etapa 1
    if (elUserModalTitle) elUserModalTitle.textContent = 'Adicionar novo usuário - Etapa 1 de 2';
    if (elUserStep1) elUserStep1.style.display = 'block';
    if (elUserStep2) elUserStep2.style.display = 'none';
    if (elUserStep1Buttons) elUserStep1Buttons.style.display = 'flex';
    if (elUserStep2Buttons) elUserStep2Buttons.style.display = 'none';
    
    // Abrir modal
    if (elUserModal) {
      console.log('Abrindo modal...');
      elUserModal.style.display = 'flex';
    } else {
      console.error('elUserModal \u00e9 null!');
    }
  }
  
  function closeUserModal() {
    if (elUserModal) {
      elUserModal.style.display = 'none';
    }
    currentCreatedUserId = null;
  }
  
  async function handleCreateUser() {
    const firstName = elUserFirstName?.value?.trim();
    const lastName = elUserLastName?.value?.trim();
    const email = elUserEmail?.value?.trim();
    const phone = elUserPhone?.value?.trim();
    
    if (!firstName || !lastName || !email) {
      alert('Por favor, preencha todos os campos obrigatórios (Nome, Sobrenome e E-mail).');
      return;
    }
    
    if (!currentCreatedGroupId) {
      alert('Erro: Perfil não encontrado.');
      return;
    }
    
    busy(elCreateUserSubmit, true, 'Criando...');
    
    try {
      // Buscar o customer owner do grupo
      const groupUrl = `/api/entityGroup/${currentCreatedGroupId}`;
      const groupResponse = await GET(groupUrl);
      const groupData = groupResponse?.data || groupResponse;
      const ownerId = groupData?.ownerId?.id || state.rootId;
      
      if (!ownerId) {
        throw new Error('Não foi possível determinar o customer do grupo');
      }
      
      // Criar payload do usuário
      const userPayload = {
        email: email,
        firstName: firstName,
        lastName: lastName,
        phone: phone || '',
        authority: 'CUSTOMER_USER',
        customerId: {
          id: ownerId,
          entityType: 'CUSTOMER'
        }
      };
      
      // Criar usuário
      const params = { sendActivationMail: false };
      const queryString = new URLSearchParams(params).toString();
      const createUserUrl = `/api/user?${queryString}`;
      
      const userResponse = await ctx.http.post(createUserUrl, userPayload, { 
        headers: { 'Content-Type': 'application/json' } 
      }).toPromise();
      
      const createdUser = userResponse?.data || userResponse;
      currentCreatedUserId = createdUser?.id?.id || createdUser?.id;
      
      if (!currentCreatedUserId) {
        throw new Error('Falha ao obter ID do usuário criado');
      }
      
      // Adicionar usuário ao grupo
      const addToGroupUrl = `/api/entityGroup/${currentCreatedGroupId}/addEntities`;
      await POST(addToGroupUrl, [currentCreatedUserId]);
      console.log('✅ Usuário adicionado ao grupo com sucesso!');
      
      // Associar usuário ao custom menu apropriado
      console.log('🎯 [FLUXO] Tentando associar usuário ao custom menu...');
      console.log('🎯 [FLUXO] userId:', currentCreatedUserId);
      console.log('🎯 [FLUXO] groupId:', currentCreatedGroupId);
      
      try {
        await assignUserToCustomMenuIfNeeded(currentCreatedUserId, currentCreatedGroupId);
        console.log('✅ [FLUXO] assignUserToCustomMenuIfNeeded concluída com sucesso!');
      } catch (menuError) {
        console.error('❌ [FLUXO] ERRO ao associar custom menu:', menuError);
        console.error('❌ [FLUXO] Stack:', menuError?.stack);
        // Não bloquear o fluxo, apenas alertar
        alert(`Aviso: Não foi possível associar o menu customizado. Erro: ${menuError?.message || 'Desconhecido'}`);
      }
      
      // Buscar link de ativação
      let activationLink = '';
      try {
        const activationResponse = await ctx.http.get(`/api/user/${currentCreatedUserId}/activationLink`, {
          responseType: 'text'
        }).toPromise();
        activationLink = activationResponse || 'Link de ativação não disponível';
      } catch (activationError) {
        activationLink = 'Link de ativação não disponível';
      }
      
      // Ir para etapa 2
      if (elUserModalTitle) elUserModalTitle.textContent = 'Adicionar novo usuário - Etapa 2 de 2';
      if (elCreatedUserName) elCreatedUserName.textContent = `${firstName} ${lastName}`;
      if (elActivationLink) elActivationLink.value = activationLink || 'Link de ativação não disponível';
      
      if (elUserStep1) {
        elUserStep1.classList.remove('active');
        elUserStep1.style.display = 'none';
      }
      if (elUserStep2) {
        elUserStep2.classList.add('active');
        elUserStep2.style.display = 'block';
      }
      if (elUserStep1Buttons) elUserStep1Buttons.style.display = 'none';
      if (elUserStep2Buttons) elUserStep2Buttons.style.display = 'flex';
      
    } catch (e) {
      // Não mostrar erro se for status 200 (sucesso)
      if (e?.status === 200 || e?.error?.status === 200) {
        return;
      }
      logErr('Erro ao criar usuário', e);
      alert(`Erro ao criar usuário: ${e?.message || 'Erro desconhecido'}.`);
    } finally {
      busy(elCreateUserSubmit, false);
    }
  }
  
  function copyActivationLink() {
    if (elActivationLink) {
      elActivationLink.select();
      document.execCommand('copy');
      
      const originalText = elCopyLinkBtn.textContent;
      elCopyLinkBtn.textContent = '✓ Copiado!';
      setTimeout(() => {
        elCopyLinkBtn.textContent = originalText;
      }, 2000);
    }
  }
  
  // Event listeners para modal de usuário
  if (elCreateUserBtn) {
    console.log('✓ Botão de criar usuário encontrado:', elCreateUserBtn);
    
    // Usar tanto onclick quanto addEventListener para garantir
    elCreateUserBtn.onclick = function(e) {
      console.log('✓ Botão clicado (onclick), abrindo modal...');
      e.preventDefault();
      e.stopPropagation();
      openUserModal();
    };
    
    elCreateUserBtn.addEventListener('click', function(e) {
      console.log('✓ Botão clicado (addEventListener), abrindo modal...');
      e.preventDefault();
      e.stopPropagation();
      openUserModal();
    });
  } else {
    console.error('✗ Botão ug-create-user-btn NÃO encontrado');
  }
  
  if (elFinishBtn) {
    elFinishBtn.addEventListener('click', hideSummarySection);
  }
  
  if (elCloseUserModal) {
    elCloseUserModal.addEventListener('click', closeUserModal);
  }
  
  if (elCreateUserSubmit) {
    elCreateUserSubmit.addEventListener('click', handleCreateUser);
  }
  
  if (elCancelUser) {
    elCancelUser.addEventListener('click', closeUserModal);
  }
  
  if (elUserFinishBtn) {
    elUserFinishBtn.addEventListener('click', closeUserModal);
  }
  
  if (elCopyLinkBtn) {
    elCopyLinkBtn.addEventListener('click', copyActivationLink);
  }
  
  // Fechar modal ao clicar no backdrop
  if (elUserModal) {
    elUserModal.addEventListener('click', (e) => {
      if (e.target === elUserModal) {
        closeUserModal();
      }
    });
  }

  // ===== Boot =====
  // Inicia carregando os clientes e já mostra o formulário (Etapa 1)
  loadAndRender();
  showFormStep1();
};

self.onDestroy = function () {
  if (filterDebounce) {
    clearTimeout(filterDebounce);
    filterDebounce = null;
  }
};

self.onResize = function () { };

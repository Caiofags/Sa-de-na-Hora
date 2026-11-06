const STORAGE_KEY = "saudeNaHoraDados_v1";
const SESSION_KEY = "saudeNaHoraSessao_v1";

const profissionaisIniciais = [
  { id: "med1", nome: "Dra. Ana Martins", especialidade: "Clínico geral" },
  { id: "med2", nome: "Dr. Paulo Lima", especialidade: "Cardiologia" },
  { id: "med3", nome: "Dra. Júlia Costa", especialidade: "Dermatologia" }
];

const horarios = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

function dataLocalHoje() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function carregarDados() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) {
    try {
      const dados = JSON.parse(salvo);
      if (dados && Array.isArray(dados.pacientes) && Array.isArray(dados.consultas)) {
        // Garante que versões anteriores tenham todas as estruturas necessárias.
        dados.profissionais = Array.isArray(dados.profissionais) ? dados.profissionais : profissionaisIniciais;
        dados.filas = Array.isArray(dados.filas) ? dados.filas : [];
        dados.historico = Array.isArray(dados.historico) ? dados.historico : [];
        dados.pilha = Array.isArray(dados.pilha) ? dados.pilha : [];
        return dados;
      }
    } catch (erro) {
      console.warn("Não foi possível ler os dados salvos. Os dados iniciais serão usados.", erro);
    }
  }

  return {
    pacientes: [],
    profissionais: profissionaisIniciais.map(p => ({ ...p })),
    consultas: [],
    filas: [],
    historico: [],
    pilha: []
  };
}

let dados = carregarDados();
let usuarioAtual = null;

function salvarDados() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dados));
}

function criarId(prefixo) {
  return `${prefixo}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, caractere => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[caractere]);
}

function mostrarMensagem(texto, erro = false) {
  const caixa = document.getElementById("message");
  caixa.textContent = texto;
  caixa.classList.toggle("erro", erro);
  caixa.classList.remove("escondido");
  window.clearTimeout(mostrarMensagem.timer);
  mostrarMensagem.timer = window.setTimeout(() => caixa.classList.add("escondido"), 5000);
}

function nomeProfissional(id) {
  const profissional = dados.profissionais.find(p => p.id === id);
  return profissional ? profissional.nome : "Profissional não encontrado";
}

function especialidadeProfissional(id) {
  const profissional = dados.profissionais.find(p => p.id === id);
  return profissional ? profissional.especialidade : "";
}

function nomePaciente(id) {
  const paciente = dados.pacientes.find(p => p.id === id);
  return paciente ? paciente.nome : "Paciente não encontrado";
}

function registrarOperacao(descricao) {
  // PILHA: a última operação é a primeira que poderá ser desfeita (LIFO).
  // O estado anterior é guardado para permitir desfazer agendamento/cancelamento/fila.
  const antes = {
    consultas: JSON.parse(JSON.stringify(dados.consultas)),
    filas: JSON.parse(JSON.stringify(dados.filas)),
    historico: JSON.parse(JSON.stringify(dados.historico))
  };
  dados.pilha.push({
    id: criarId("op"),
    descricao,
    dataHora: new Date().toLocaleString("pt-BR"),
    antes
  });
  // Mantém as 20 operações mais recentes para não crescer indefinidamente.
  if (dados.pilha.length > 20) dados.pilha.shift();
}

function profissionalTemConsulta(profissionalId, data, horario) {
  // LAÇO: procura uma consulta ativa com a mesma combinação profissional/data/horário.
  for (let i = 0; i < dados.consultas.length; i++) {
    const consulta = dados.consultas[i];
    if (
      consulta.profissionalId === profissionalId &&
      consulta.data === data &&
      consulta.horario === horario &&
      consulta.status === "agendada"
    ) {
      return true;
    }
  }
  return false;
}

function consultaDoPacienteNoHorario(pacienteId, data, horario) {
  return dados.consultas.some(c =>
    c.pacienteId === pacienteId && c.data === data &&
    c.horario === horario && c.status === "agendada"
  );
}

function obterFila(profissionalId, data, horario) {
  return dados.filas
    .filter(f => f.profissionalId === profissionalId && f.data === data && f.horario === horario)
    .sort((a, b) => a.ordem - b.ordem);
}

function entrarNaFila(profissionalId, data, horario) {
  if (obterFila(profissionalId, data, horario).some(f => f.pacienteId === usuarioAtual.id)) {
    mostrarMensagem("Você já está na fila para esse horário.", true);
    return;
  }
  if (consultaDoPacienteNoHorario(usuarioAtual.id, data, horario)) {
    mostrarMensagem("Você já possui uma consulta nesse dia e horário.", true);
    return;
  }

  registrarOperacao(`Entrada na fila: ${usuarioAtual.nome} — ${data} às ${horario}`);
  const filaAtual = obterFila(profissionalId, data, horario);
  const proximaOrdem = filaAtual.length ? filaAtual[filaAtual.length - 1].ordem + 1 : 1;
  dados.filas.push({
    id: criarId("fila"),
    pacienteId: usuarioAtual.id,
    profissionalId,
    data,
    horario,
    ordem: proximaOrdem,
    criadoEm: new Date().toISOString()
  });
  salvarDados();
  atualizarTudo();
  mostrarMensagem("Você entrou na fila de espera.");
}

function promoverProximoDaFila(profissionalId, data, horario) {
  const fila = obterFila(profissionalId, data, horario);
  if (!fila.length || profissionalTemConsulta(profissionalId, data, horario)) return null;

  // FILA: o primeiro paciente a entrar (menor ordem) é atendido primeiro (FIFO).
  const proximo = fila[0];
  dados.filas = dados.filas.filter(f => f.id !== proximo.id);
  const consulta = {
    id: criarId("cons"),
    pacienteId: proximo.pacienteId,
    profissionalId,
    data,
    horario,
    status: "agendada",
    criadaEm: new Date().toISOString()
  };
  dados.consultas.push(consulta);
  dados.historico.push({
    id: criarId("hist"),
    tipo: "Promovido da fila",
    pacienteId: proximo.pacienteId,
    profissionalId,
    data,
    horario,
    quando: new Date().toISOString()
  });
  return consulta;
}

function agendarConsulta(profissionalId, data, horario) {
  if (!profissionalId || !data || !horario) {
    mostrarMensagem("Preencha profissional, data e horário.", true);
    return;
  }
  if (data < dataLocalHoje()) {
    mostrarMensagem("Escolha uma data de hoje em diante.", true);
    return;
  }
  if (!horarios.includes(horario)) {
    mostrarMensagem("Horário inválido.", true);
    return;
  }
  if (profissionalTemConsulta(profissionalId, data, horario)) {
    const entrar = confirm("Esse horário já está ocupado. Deseja entrar na fila de espera?");
    if (entrar) entrarNaFila(profissionalId, data, horario);
    return;
  }
  if (consultaDoPacienteNoHorario(usuarioAtual.id, data, horario)) {
    mostrarMensagem("Você já tem uma consulta nesse dia e horário.", true);
    return;
  }

  registrarOperacao(`Agendamento: ${usuarioAtual.nome} — ${data} às ${horario}`);
  dados.consultas.push({
    id: criarId("cons"),
    pacienteId: usuarioAtual.id,
    profissionalId,
    data,
    horario,
    status: "agendada",
    criadaEm: new Date().toISOString()
  });
  salvarDados();
  atualizarTudo();
  mostrarMensagem("Consulta agendada com sucesso.");
}

function cancelarConsulta(consultaId) {
  const consulta = dados.consultas.find(c => c.id === consultaId);
  if (!consulta || consulta.status !== "agendada") return;
  if (consulta.pacienteId !== usuarioAtual.id) {
    mostrarMensagem("Você só pode cancelar suas próprias consultas.", true);
    return;
  }
  if (!confirm(`Cancelar a consulta de ${consulta.data} às ${consulta.horario}?`)) return;

  registrarOperacao(`Cancelamento: ${consulta.data} às ${consulta.horario}`);
  consulta.status = "cancelada";
  dados.historico.push({
    id: criarId("hist"),
    tipo: "Consulta cancelada",
    pacienteId: consulta.pacienteId,
    profissionalId: consulta.profissionalId,
    data: consulta.data,
    horario: consulta.horario,
    quando: new Date().toISOString()
  });

  const promovida = promoverProximoDaFila(consulta.profissionalId, consulta.data, consulta.horario);
  salvarDados();
  atualizarTudo();
  if (promovida) {
    mostrarMensagem(`Consulta cancelada. ${nomePaciente(promovida.pacienteId)} foi promovido(a) da fila para o horário.`);
  } else {
    mostrarMensagem("Consulta cancelada. O horário está livre novamente.");
  }
}

function preencherProfissionais() {
  const select = document.getElementById("professionalSelect");
  const filtro = document.getElementById("searchProfessional");
  const valorAtual = select.value;
  select.innerHTML = '<option value="">Selecione</option>' + dados.profissionais.map(p =>
    `<option value="${escaparHTML(p.id)}">${escaparHTML(p.nome)} — ${escaparHTML(p.especialidade)}</option>`
  ).join("");
  filtro.innerHTML = '<option value="">Todos</option>' + dados.profissionais.map(p =>
    `<option value="${escaparHTML(p.id)}">${escaparHTML(p.nome)}</option>`
  ).join("");
  if (dados.profissionais.some(p => p.id === valorAtual)) select.value = valorAtual;
}

function preencherHorarios() {
  const profissionalId = document.getElementById("professionalSelect").value;
  const data = document.getElementById("appointmentDate").value;
  const select = document.getElementById("appointmentTime");
  if (!profissionalId || !data) {
    select.innerHTML = '<option value="">Selecione a data e o profissional</option>';
    desenharMatrizAgendamento();
    return;
  }

  select.innerHTML = '<option value="">Selecione um horário</option>' + horarios.map(h => {
    const ocupado = profissionalTemConsulta(profissionalId, data, h);
    const fila = obterFila(profissionalId, data, h).length;
    const texto = ocupado ? `${h} — ocupado${fila ? ` (${fila} na fila)` : ""}` : `${h} — disponível`;
    return `<option value="${h}">${escaparHTML(texto)}</option>`;
  }).join("");
  desenharMatrizAgendamento();
}

function desenharMatrizAgendamento() {
  const profissionalId = document.getElementById("professionalSelect").value;
  const data = document.getElementById("appointmentDate").value;
  const container = document.getElementById("slotMatrix");
  const mensagem = document.getElementById("slotMessage");

  if (!profissionalId || !data) {
    container.innerHTML = "";
    mensagem.textContent = "Selecione um profissional e uma data para consultar os horários.";
    return;
  }

  // MATRIZ: cada linha representa um profissional e cada coluna um horário.
  const matriz = [horarios.map(h => profissionalTemConsulta(profissionalId, data, h) ? "Ocupado" : "Livre")];
  mensagem.textContent = `${nomeProfissional(profissionalId)} — ${especialidadeProfissional(profissionalId)} — ${data}`;
  let html = "<table><thead><tr><th>Profissional / horário</th>";
  horarios.forEach(h => html += `<th>${h}</th>`);
  html += "</tr></thead><tbody><tr><th>" + escaparHTML(nomeProfissional(profissionalId)) + "</th>";
  matriz[0].forEach((estado, i) => {
    const classe = estado === "Livre" ? "disponivel" : "ocupado";
    const fila = obterFila(profissionalId, data, horarios[i]).length;
    html += `<td class="${classe}">${estado}${fila ? `<br><small>${fila} na fila</small>` : ""}</td>`;
  });
  html += "</tr></tbody></table>";
  container.innerHTML = html;
}

function formatarData(data) {
  if (!data) return "";
  const partes = data.split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : data;
}

function criarCardConsulta(consulta, mostrarCancelar = false) {
  const paciente = dados.pacientes.find(p => p.id === consulta.pacienteId);
  const podeCancelar = mostrarCancelar && consulta.pacienteId === usuarioAtual.id && consulta.status === "agendada";
  return `<article class="card-item">
    <p><strong>${escaparHTML(formatarData(consulta.data))} às ${escaparHTML(consulta.horario)}</strong></p>
    <p>Profissional: ${escaparHTML(nomeProfissional(consulta.profissionalId))}</p>
    <p>Especialidade: ${escaparHTML(especialidadeProfissional(consulta.profissionalId))}</p>
    ${paciente ? `<p>Paciente: ${escaparHTML(paciente.nome)}</p>` : ""}
    <p>Status: <span class="status">${escaparHTML(consulta.status)}</span></p>
    ${podeCancelar ? `<button type="button" data-cancelar="${escaparHTML(consulta.id)}" class="secundario">Cancelar consulta</button>` : ""}
  </article>`;
}

function atualizarMinhasConsultas() {
  const dataFiltro = document.getElementById("searchDate").value;
  const profissionalFiltro = document.getElementById("searchProfessional").value;
  const hoje = dataLocalHoje();

  // LAÇOS/filtros: percorre a lista de consultas e aplica os critérios de pesquisa.
  const minhas = dados.consultas.filter(c => {
    if (c.pacienteId !== usuarioAtual.id) return false;
    if (dataFiltro && c.data !== dataFiltro) return false;
    if (profissionalFiltro && c.profissionalId !== profissionalFiltro) return false;
    return true;
  });

  const futuras = minhas.filter(c => c.status === "agendada" && c.data >= hoje)
    .sort((a, b) => `${a.data} ${a.horario}`.localeCompare(`${b.data} ${b.horario}`));
  const passadas = minhas.filter(c => c.status !== "agendada" || c.data < hoje)
    .sort((a, b) => `${b.data} ${b.horario}`.localeCompare(`${a.data} ${a.horario}`));

  document.getElementById("futureAppointments").innerHTML = futuras.length
    ? futuras.map(c => criarCardConsulta(c, true)).join("")
    : '<p class="vazio">Nenhuma consulta futura encontrada.</p>';
  document.getElementById("pastAppointments").innerHTML = passadas.length
    ? passadas.map(c => criarCardConsulta(c, false)).join("")
    : '<p class="vazio">Nenhum registro no histórico para os filtros selecionados.</p>';
}

function atualizarProfissionaisEMatriz() {
  document.getElementById("professionalsList").innerHTML = dados.profissionais.map(p =>
    `<article class="profissional"><h3>${escaparHTML(p.nome)}</h3><p>${escaparHTML(p.especialidade)}</p><p>Horários: ${horarios.join(", ")}</p></article>`
  ).join("");

  const data = document.getElementById("matrixDate").value || dataLocalHoje();
  // MATRIZ completa: linhas = profissionais; colunas = horários daquele dia.
  const matriz = dados.profissionais.map(p => ({
    profissional: p,
    estados: horarios.map(h => profissionalTemConsulta(p.id, data, h) ? "Ocupado" : "Livre")
  }));

  let html = `<p><strong>Agenda de ${escaparHTML(formatarData(data))}</strong></p><table><thead><tr><th>Profissional</th>`;
  horarios.forEach(h => html += `<th>${h}</th>`);
  html += "</tr></thead><tbody>";
  matriz.forEach(linha => {
    html += `<tr><th>${escaparHTML(linha.profissional.nome)}</th>`;
    linha.estados.forEach(estado => {
      html += `<td class="${estado === "Livre" ? "disponivel" : "ocupado"}">${estado}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  document.getElementById("allMatrix").innerHTML = html;
}

function atualizarFila() {
  const filaOrdenada = [...dados.filas].sort((a, b) =>
    `${a.data} ${a.horario}`.localeCompare(`${b.data} ${b.horario}`) || a.ordem - b.ordem
  );
  const container = document.getElementById("waitingList");
  if (!filaOrdenada.length) {
    container.innerHTML = '<p class="vazio">A fila de espera está vazia.</p>';
    return;
  }

  // O array é ordenado por data/horário e ordem de entrada, mostrando a fila real.
  container.innerHTML = filaOrdenada.map(item => `
    <article class="card-item">
      <p><strong>Posição na fila: ${item.ordem}</strong></p>
      <p>Paciente: ${escaparHTML(nomePaciente(item.pacienteId))}</p>
      <p>Profissional: ${escaparHTML(nomeProfissional(item.profissionalId))}</p>
      <p>Data e horário: ${escaparHTML(formatarData(item.data))} às ${escaparHTML(item.horario)}</p>
      ${item.pacienteId === usuarioAtual.id ? `<button class="secundario" type="button" data-sair-fila="${escaparHTML(item.id)}">Sair da fila</button>` : ""}
    </article>
  `).join("");
}

function atualizarOperacoes() {
  const pilha = dados.pilha;
  document.getElementById("undoBtn").disabled = pilha.length === 0;
  const container = document.getElementById("operationList");
  if (!pilha.length) {
    container.innerHTML = '<p class="vazio">Nenhuma operação registrada.</p>';
    return;
  }
  // A pilha é exibida do topo para a base: a última operação aparece primeiro.
  container.innerHTML = [...pilha].reverse().map((op, indice) => `
    <article class="card-item">
      <p><strong>${indice === 0 ? "Topo da pilha — " : ""}${escaparHTML(op.descricao)}</strong></p>
      <p class="ajuda">${escaparHTML(op.dataHora)}</p>
    </article>
  `).join("");
}

function desfazerUltimaOperacao() {
  if (!dados.pilha.length) {
    mostrarMensagem("Não há operação para desfazer.", true);
    return;
  }
  const operacao = dados.pilha.pop();
  if (!confirm(`Desfazer a operação: ${operacao.descricao}?`)) {
    dados.pilha.push(operacao);
    return;
  }
  dados.consultas = operacao.antes.consultas;
  dados.filas = operacao.antes.filas;
  dados.historico = operacao.antes.historico;
  salvarDados();
  atualizarTudo();
  mostrarMensagem("Última operação desfeita.");
}

function atualizarTudo() {
  preencherProfissionais();
  preencherHorarios();
  atualizarMinhasConsultas();
  atualizarProfissionaisEMatriz();
  atualizarFila();
  atualizarOperacoes();
}

function abrirAplicacao() {
  document.getElementById("authView").classList.add("escondido");
  document.getElementById("appView").classList.remove("escondido");
  document.getElementById("logoutBtn").classList.remove("escondido");
  document.getElementById("welcomeTitle").textContent = `Olá, ${usuarioAtual.nome}!`;
  document.getElementById("appointmentDate").min = dataLocalHoje();
  document.getElementById("matrixDate").value = dataLocalHoje();
  atualizarTudo();
}

function sair() {
  usuarioAtual = null;
  localStorage.removeItem(SESSION_KEY);
  document.getElementById("appView").classList.add("escondido");
  document.getElementById("authView").classList.remove("escondido");
  document.getElementById("logoutBtn").classList.add("escondido");
  document.getElementById("loginForm").reset();
  mostrarMensagem("Você saiu do sistema.");
}

function trocarAbaAuth(aba) {
  const login = aba === "login";
  document.getElementById("loginForm").classList.toggle("escondido", !login);
  document.getElementById("registerForm").classList.toggle("escondido", login);
  document.getElementById("loginTab").classList.toggle("ativa", login);
  document.getElementById("registerTab").classList.toggle("ativa", !login);
}

function trocarTela(nome) {
  document.querySelectorAll(".appSection").forEach(secao => secao.classList.add("escondido"));
  document.getElementById(`view-${nome}`).classList.remove("escondido");
  document.querySelectorAll(".navBtn").forEach(botao =>
    botao.classList.toggle("ativa", botao.dataset.view === nome)
  );
  if (nome === "minhas") atualizarMinhasConsultas();
  if (nome === "profissionais") atualizarProfissionaisEMatriz();
  if (nome === "fila") atualizarFila();
  if (nome === "operacoes") atualizarOperacoes();
}

function aplicarMascaraTelefone(valor) {
  // Mantém apenas números e aplica a máscara durante a digitação.
  let numeros = valor.replace(/\D/g, "").slice(0, 11);
  if (numeros.length > 10) {
    numeros = numeros.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
  } else if (numeros.length > 6) {
    numeros = numeros.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
  } else if (numeros.length > 2) {
    numeros = numeros.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
  } else if (numeros.length > 0) {
    numeros = numeros.replace(/^(\d*)/, "($1");
  }
  return numeros;
}

// Eventos de cadastro/login
document.getElementById("loginTab").addEventListener("click", () => trocarAbaAuth("login"));
document.getElementById("registerTab").addEventListener("click", () => trocarAbaAuth("cadastro"));
document.getElementById("registerPhone").addEventListener("input", evento => {
  evento.target.value = aplicarMascaraTelefone(evento.target.value);
});

document.getElementById("registerForm").addEventListener("submit", evento => {
  evento.preventDefault();
  const nome = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim().toLowerCase();
  const telefone = document.getElementById("registerPhone").value.trim();
  const senha = document.getElementById("registerPassword").value;
  const confirmar = document.getElementById("registerPasswordConfirm").value;

  if (nome.length < 3) return mostrarMensagem("Informe um nome com pelo menos 3 caracteres.", true);
  if (!/^\(\d{2}\) \d{5}-\d{4}$/.test(telefone)) return mostrarMensagem("Telefone inválido. Use o formato (00) 00000-0000.", true);
  if (senha.length < 4) return mostrarMensagem("A senha precisa ter pelo menos 4 caracteres.", true);
  if (senha !== confirmar) return mostrarMensagem("As senhas não são iguais.", true);
  if (dados.pacientes.some(p => p.email === email)) return mostrarMensagem("Já existe uma conta com esse e-mail.", true);

  const paciente = { id: criarId("pac"), nome, email, telefone, senha, criadoEm: new Date().toISOString() };
  dados.pacientes.push(paciente);
  salvarDados();
  usuarioAtual = paciente;
  localStorage.setItem(SESSION_KEY, paciente.id);
  document.getElementById("registerForm").reset();
  abrirAplicacao();
  mostrarMensagem("Cadastro realizado com sucesso!");
});

document.getElementById("loginForm").addEventListener("submit", evento => {
  evento.preventDefault();
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const senha = document.getElementById("loginPassword").value;
  const paciente = dados.pacientes.find(p => p.email === email && p.senha === senha);
  if (!paciente) return mostrarMensagem("E-mail ou senha incorretos.", true);

  usuarioAtual = paciente;
  localStorage.setItem(SESSION_KEY, paciente.id);
  abrirAplicacao();
  mostrarMensagem("Login realizado com sucesso!");
});

document.getElementById("logoutBtn").addEventListener("click", sair);

// Eventos de navegação e agenda
document.querySelectorAll(".navBtn").forEach(botao => {
  botao.addEventListener("click", () => trocarTela(botao.dataset.view));
});

document.getElementById("professionalSelect").addEventListener("change", preencherHorarios);
document.getElementById("appointmentDate").addEventListener("change", preencherHorarios);
document.getElementById("appointmentForm").addEventListener("submit", evento => {
  evento.preventDefault();
  agendarConsulta(
    document.getElementById("professionalSelect").value,
    document.getElementById("appointmentDate").value,
    document.getElementById("appointmentTime").value
  );
});

document.getElementById("searchDate").addEventListener("change", atualizarMinhasConsultas);
document.getElementById("searchProfessional").addEventListener("change", atualizarMinhasConsultas);
document.getElementById("clearFilters").addEventListener("click", () => {
  document.getElementById("searchDate").value = "";
  document.getElementById("searchProfessional").value = "";
  atualizarMinhasConsultas();
});

document.getElementById("refreshMatrix").addEventListener("click", atualizarProfissionaisEMatriz);
document.getElementById("matrixDate").addEventListener("change", atualizarProfissionaisEMatriz);
document.getElementById("undoBtn").addEventListener("click", desfazerUltimaOperacao);

// Botões que são criados dinamicamente dentro dos cards.
document.addEventListener("click", evento => {
  const botaoCancelar = evento.target.closest("[data-cancelar]");
  if (botaoCancelar) cancelarConsulta(botaoCancelar.dataset.cancelar);

  const botaoSairFila = evento.target.closest("[data-sair-fila]");
  if (botaoSairFila) {
    const item = dados.filas.find(f => f.id === botaoSairFila.dataset.sairFila);
    if (!item || item.pacienteId !== usuarioAtual.id) return;
    registrarOperacao(`Saída da fila: ${formatarData(item.data)} às ${item.horario}`);
    dados.filas = dados.filas.filter(f => f.id !== item.id);
    // Reorganiza as posições restantes para aquele horário.
    obterFila(item.profissionalId, item.data, item.horario).forEach((f, indice) => f.ordem = indice + 1);
    salvarDados();
    atualizarTudo();
    mostrarMensagem("Você saiu da fila de espera.");
  }
});

// Recupera a sessão da última visita, caso ainda exista.
const sessaoSalva = localStorage.getItem(SESSION_KEY);
if (sessaoSalva) {
  usuarioAtual = dados.pacientes.find(p => p.id === sessaoSalva) || null;
  if (usuarioAtual) abrirAplicacao();
  else localStorage.removeItem(SESSION_KEY);
}

// Garante que as estruturas iniciais estejam salvas.
salvarDados();

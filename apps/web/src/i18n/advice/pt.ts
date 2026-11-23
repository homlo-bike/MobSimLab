import type { AdviceMessages } from "./en";

/** Advice messages (pt). */
export const advicePt = {
  "advice.title": "O que melhorar",
  "advice.intro":
    "Os problemas que esta execução encontrou, o mais grave primeiro, e o que pode fazer em cada caso.",
  "advice.none": "Nada a melhorar: esta execução não encontrou nenhum estrangulamento nem problema.",
  "advice.show": "Mostrar no mapa",
  "advice.more": "Mais {n} não mostrados.",
  "advice.severity.problem": "Problema",
  "advice.severity.warning": "Aviso",
  "advice.crowdMap": "Mostrar no mapa a lotação dos veículos (hora de ponta de cada linha)",
  "advice.cap.stopped": "{line}: a execução parou: {problem}",
  "advice.cap.stoppedFix": "Corrija isto na ferramenta ferroviária e execute o teste de novo.",
  "advice.cap.unplaced": "{line}: viagens que não cabem na via: {n}",
  "advice.cap.unplacedFix":
    "Faça a linha circular menos vezes neste período, ou dê aos seus comboios mais espaço onde se cruzam: mais linhas de cais ou travessões em {terminal}, ou um ponto de cruzamento em via única.",
  "advice.cap.terminal":
    "{line}: o terminal {terminal} é o estrangulamento, ocupado {share} da hora de ponta (limite {limit})",
  "advice.cap.terminalFix":
    "Os comboios ocupam as suas linhas de cais demasiado tempo. Encurte a inversão (uma paragem mais curta, ou um maquinista à espera em cada extremo), acrescente uma linha de cais, ou aproxime o travessão dos cais para que os comboios o libertem mais cedo.",
  "advice.cap.section":
    "{line}: a secção de via {section} é o estrangulamento, ocupada {share} da hora de ponta (limite {limit})",
  "advice.cap.sectionFix":
    "Os comboios ocupam esta secção mais tempo do que qualquer outra. Uma velocidade maior nela fá-los libertá-la mais cedo; caso contrário, faça circular menos comboios aqui.",
  "advice.cap.sectionPlatform":
    "Esta secção é uma linha de cais: os comboios ocupam-na enquanto estão parados no cais. Paragens mais curtas, ou uma segunda linha de cais para este sentido, deixam entrar mais cedo o comboio seguinte.",
  "advice.cap.sectionSwitches":
    "Esta secção é uma zona de aparelhos de via: os comboios ocupam-na enquanto o itinerário pelos aparelhos é estabelecido e desfeito. Aparelhos com maior velocidade na via desviada, ou colocados de modo que os dois sentidos não se cruzem, libertam-na mais cedo.",
  "advice.cap.signalAdd":
    "Esta secção de plena via tem {length} m, mas um cantão só precisa de {block} m a {speed} km/h. Acrescente um sinal de bloqueio a cerca de {at} m na via {track}, para que o comboio seguinte possa entrar mais cedo na primeira metade.",
  "advice.cap.signalShort":
    "Esta secção tem {length} m, menos que dois cantões de {block} m a {speed} km/h, por isso outro sinal deixaria pouco espaço para parar. Os comboios podem seguir-se mais de perto com sinalização em cabina (CBTC ou ETCS nível 2), ou com uma velocidade mais baixa aqui.",
  "advice.cap.sectionCab":
    "Com sinalização em cabina os comboios já se seguem à distância de travagem ({block} m a {speed} km/h); não são os sinais que fixam o espaçamento. Uma velocidade maior na secção, ou menos comboios, liberta-a mais cedo.",
  "advice.cap.sectionSight":
    "Aqui os elétricos circulam à vista, por isso não são os sinais que fixam o espaçamento. Paragens mais curtas por perto, ou uma via própria longe do trânsito, libertam-na mais cedo.",
  "advice.cap.nearNote": "Ainda funciona, mas há pouca margem para acrescentar comboios.",
  "advice.cap.pileUp": "{line}: os atrasos acumulam-se e ainda são de {late} em média no fim do período",
  "advice.cap.pileUpFix":
    "Acrescente tempo de recuperação nos terminais, ou circule um pouco menos vezes, para que um comboio atrasado não retenha o seguinte.",
  "advice.cap.full": "{line}: os veículos vão a {share} de {from} a {to}, {time}",
  "advice.cap.fullMore":
    "{left} pessoas ficam para trás ao longo do período. A via permite até {n} comboios por hora e sentido: circule mais vezes, ou use comboios mais longos.",
  "advice.cap.fullLonger":
    "{left} pessoas ficam para trás ao longo do período. Circule mais vezes se a via o permitir, ou use veículos mais longos.",
  "advice.cap.streetPileUp": "{line}: os atrasos acumulam-se na rua e ainda são de {late} no fim",
  "advice.cap.streetPileUpFix":
    "Planeie mais tempo para a volta ou uma paragem mais longa nos terminais, para que os veículos recuperem; o que mais ajuda é uma faixa própria onde encontram trânsito.",
  "advice.road.cannotRun": "{line} não pôde circular",
  "advice.road.cannotRunFix": "{problem}. Corrija a rota em Criar → Rota de rua e execute de novo.",
  "advice.road.late": "{line}: só {share} das partidas a horas (aviso abaixo de {limit})",
  "advice.road.mostlySignals":
    "Cada viagem perde {signals} min em semáforos vermelhos e {traffic} min no trânsito, portanto a maior parte nos semáforos aqui listados.",
  "advice.road.mostlyTraffic":
    "Cada viagem perde {traffic} min no trânsito e {signals} min em semáforos vermelhos, portanto a maior parte nas ruas aqui listadas.",
  "advice.road.moreTime":
    "A volta demorou {run} min contra {planned} min previstos: planeie mais tempo de percurso, ou acrescente um veículo.",
  "advice.road.bunched": "{line}: {share} das partidas chegam agrupadas",
  "advice.road.bunchedFix":
    "Os veículos apanham-se uns aos outros. Retenha-os nos terminais segundo o horário, dê-lhes lá uma paragem mais longa, ou dê à linha uma faixa própria onde perde tempo.",
  "advice.road.ranOut": "{line}: veículos que ficaram sem carga: {n}",
  "advice.road.ranOutFix":
    "Use uma bateria maior, carregue nos terminais, ou troque os veículos durante o dia.",
  "advice.road.stuck": "{line}: veículos parados 5 minutos ou mais: {n}",
  "advice.road.stuckFix":
    "Verifique no separador SIG a configuração da rua e os semáforos neste local: pode faltar uma viragem, ou o trânsito bloqueia o cruzamento.",
  "advice.road.notBack": "{line}: veículos que não voltaram ao depósito no fim: {n}",
  "advice.road.notBackFix":
    "Verifique o percurso entre a linha e o seu depósito, ou deixe mais tempo após a última viagem.",
  "advice.road.unnamedStreet": "uma rua sem nome",
  "advice.road.unnamedJunction": "um cruzamento",
  "advice.road.spot.signal": "Semáforo vermelho em {place}: {min} min perdidos no total ({lines})",
  "advice.road.spot.signalFix":
    "As linhas esperam aqui mais do que em qualquer outro lado. Peça prioridade para elas neste semáforo, ou tempos de semáforo que lhes convenham. A simulação viária ainda não modela a prioridade, por isso não pode mostrar o ganho.",
  "advice.road.spot.street": "Trânsito em {place}: {min} min perdidos no total ({lines})",
  "advice.road.spot.streetFix":
    "Dê às linhas uma faixa própria nesta rua (separador SIG, configuração da rua: faixa BUS), ou leve-as por outra rua.",
  "advice.road.spot.junction": "Parados em {place}: {min} min perdidos no total ({lines})",
  "advice.road.spot.junctionFix":
    "Os veículos ficam parados dentro deste cruzamento, à espera de virar ou que a saída fique livre. Ajuda uma faixa própria até ele, ou uma fase de viragem separada nos seus semáforos.",
} satisfies AdviceMessages;

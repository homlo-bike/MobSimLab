import type { WorkspaceUiMessages } from "./en";

/** Top bar, checks and Settings messages (kk). */
export const workspaceUiKk = {
  "checks.menu": "Тексерулер",
  "checks.menuCount": "Тексерулер: {errors} қате, {warnings} ескерту",
  "checks.title": "Барлық режимдердің тексерулері",
  "checks.none":
    "Әзірге тексеретін ештеңе жоқ. Желі, теміржол немесе депо сызыңыз, оның тексерулері осында көрінеді.",
  "checks.lastOpened": "соңғы рет ашылғандағыдай",
  "checks.streetLine": "Көше желісі · {name}",
  "checks.railway": "Теміржол",
  "checks.depot": "Депо · {name}",
  "undo.undo": "Болдырмау",
  "undo.redo": "Қайталау",
  "tour.checks.title": "Тексерулер",
  "tour.checks.body":
    "Қоңырау барлық режимдердің тексерулерін көрсетеді, алдымен қателер: көше желілері, теміржол, деполар және плагиндердің желілері. Қай жерде екенін көру үшін біреуін таңдаңыз.",
  "settings.serverTab": "Сервер",
  "settings.server.local":
    "MobSimLab осы компьютерде жұмыс істеп тұр. Оның орнына бұл қолданбаны фонда жұмыс істейтін MobSimLab серверіне, мысалы, Docker серверіне қосуға болады.",
  "settings.server.address": "Сервер мекенжайы",
  "settings.server.connect": "Қосылу",
  "settings.server.note":
    "Қолданба серверді тексеріп, ауыспас бұрын сұрайды. Осы компьютердегі жобалар осында қалады: оларды .mslab файлдары ретінде сақтап көшіріңіз. Қолданба параметрлерінде (⌘, немесе Ctrl+,) қайта ауысуға болады.",
} satisfies WorkspaceUiMessages;

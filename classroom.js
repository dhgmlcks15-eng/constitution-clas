const callbackParams = new URLSearchParams(location.hash.slice(1));
if (callbackParams.get("type") === "recovery") sessionStorage.setItem("class-recovery","1");
const client = supabase.createClient(classroomConfig.url, classroomConfig.publishableKey, {
  auth: {storage: sessionStorage, storageKey: document.querySelector("#registration") ? "constitution-teacher-session" : "constitution-class-session",flowType:"implicit"}
});
let accountId, profile;
async function rpc(name, args = {}) {
  const {data,error} = await client.rpc("classroom_" + name,args);
  if (error) throw error;
  return data;
}
function studentLogin(ready) {
  const entry = document.querySelector("#studentEntry");
  const registration = document.querySelector("#studentRegistration");
  const legacy = document.querySelector("#legacyLogin");
  const recovery = document.querySelector("#recovery");
  const google = document.querySelector("#studentGoogle");
  const status = document.querySelector("#entryStatus");
  const redirectTo = location.origin + location.pathname;
  function checked(result) { if (result.error) throw result.error; return result.data; }
  function show(panel) {
    for (const el of [entry,registration,recovery,document.querySelector("#app")]) el.hidden = el !== panel;
  }
  async function enter() {
    const {user} = checked(await client.auth.getUser());
    accountId = user.id;
    profile = await rpc("profile");
    if (!profile) {
      document.querySelector("#studentAccount").textContent = user.email;
      show(registration);
      registration.room.focus();
      return;
    }
    if (profile.role !== "student") throw Error("학생용 Google 계정을 선택해 주세요.");
    await ready();
    show(document.querySelector("#app"));
  }
  google.onclick = async () => {
    google.disabled = true;
    try { checked(await client.auth.signInWithOAuth({provider:"google",options:{redirectTo,queryParams:{prompt:"select_account"}}})); }
    catch(error) { status.textContent = error.message; google.disabled = false; }
  };
  function onSubmit(form, handle) {
    form.onsubmit = async event => {
      event.preventDefault();
      const button = event.submitter || form.querySelector("button");
      button.disabled = true;
      const output = form.querySelector("output");
      output.textContent = "";
      try { await handle(button,output); } catch(error) { output.textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  onSubmit(registration,async () => {
    const name = registration.displayName.value.trim();
    if (!name) throw Error("이름을 입력하세요.");
    await rpc("join_student",{room:registration.room.value,number:registration.sid.value,display_name:name});
    await enter();
  });
  onSubmit(legacy,async (button,output) => {
    if (!legacy.email.reportValidity()) return;
    const email = legacy.email.value.trim();
    if (button.value === "reset") {
      checked(await client.auth.resetPasswordForEmail(email,{redirectTo}));
      output.textContent = "이메일에서 재설정 링크를 확인하세요.";
      return;
    }
    checked(await client.auth.signInWithPassword({email,password:legacy.password.value}));
    legacy.reset();
    await enter();
  });
  async function signOut() {
    checked(await client.auth.signOut({scope:"local"}));
    sessionStorage.removeItem("class-recovery");
    location.replace(redirectTo);
  }
  onSubmit(recovery,async () => {
    checked(await client.auth.updateUser({password:recovery.newPassword.value}));
    await signOut();
  });
  document.querySelector("#studentSwitch").onclick = signOut;
  document.querySelector("#logout").onclick = signOut;
  async function restore() {
    const {session} = checked(await client.auth.getSession());
    if (!session) {
      sessionStorage.removeItem("class-recovery");
      if (callbackParams.has("error")) throw Error("인증을 완료하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    if (sessionStorage.getItem("class-recovery")) {show(recovery);return;}
    await enter();
  }
  return restore().catch(error => { status.textContent = error.message; });
}

function teacherLogin(ready) {
  const loginForm = document.querySelector("#login");
  const registration = document.querySelector("#registration");
  const redirectTo = location.origin + location.pathname;
  async function openDashboard() {
    await ready();
    registration.reset();
    registration.hidden = true;
    loginForm.hidden = true;
    document.querySelector("#app").hidden = false;
  }
  loginForm.onsubmit = async event => {
    event.preventDefault();
    const button = loginForm.querySelector("button");
    button.disabled = true;
    try {
      const {error} = await client.auth.signInWithOAuth({provider:"google", options:{redirectTo, queryParams:{prompt:"select_account"}}});
      if (error) throw error;
    } catch (error) {
      loginForm.querySelector("output").textContent = error.message;
      button.disabled = false;
    }
  };
  async function signOut() {
    const {error} = await client.auth.signOut({scope:"local"});
    if (error) {
      (registration.hidden ? loginForm : registration).querySelector("output").textContent = error.message;
      return;
    }
    location.replace(redirectTo);
  }
  document.querySelector("#switchGoogle").onclick = signOut;
  document.querySelector("#logout").onclick = signOut;
  registration.onsubmit = async event => {
    event.preventDefault();
    const button = registration.querySelector("button");
    button.disabled = true;
    try {
      if (!await rpc("join_teacher",{invite:registration.invite.value.trim()})) throw Error("가입 코드를 확인해 주세요. 여러 번 틀리면 잠시 후 다시 시도해야 합니다.");
      profile = await rpc("profile");
      if (profile?.role !== "teacher" && profile?.role !== "admin") throw Error("교사 권한을 확인하지 못했습니다. 다시 로그인해 주세요.");
      await openDashboard();
    } catch (error) { registration.querySelector("output").textContent = error.message; }
    finally { button.disabled = false; }
  };
  async function restore() {
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      if (callbackParams.has("error")) throw Error("Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    const result = await client.auth.getUser();
    if (result.error) throw result.error;
    const user = result.data.user;
    accountId = user.id;
    profile = await rpc("profile");
    if (profile?.role === "admin") await rpc("join_teacher",{invite:""});
    if (profile?.role === "admin" || profile?.role === "teacher") return openDashboard();
    loginForm.hidden = true;
    document.querySelector("#teacherAccount").textContent = user.email;
    registration.hidden = false;
    registration.invite.focus();
  }
  return restore().catch(error => { loginForm.querySelector("output").textContent = error.message; });
}

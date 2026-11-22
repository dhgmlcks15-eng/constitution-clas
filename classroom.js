const callbackParams = new URLSearchParams(location.hash.slice(1));
const isAuthCallback = callbackParams.has("access_token");
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
function login(role, ready) {
  const form = document.querySelector("#login"), message = form.querySelector("output");
  const redirectTo = location.origin + location.pathname;
  const reportError = error => { message.textContent = error.message; };
  async function enter() {
    const {data:{user},error} = await client.auth.getUser();
    if (error || !user) throw Error("로그인이 필요합니다.");
    accountId = user.id;
    profile = await rpc("profile");
    if (!profile) {
      const meta = user.user_metadata || {};
      await rpc("join_student",{room:form.room.value || meta.room,number:form.sid.value || meta.sid,display_name:form.displayName.value.trim() || meta.display_name || ""});
      profile = await rpc("profile");
    }
    if (profile?.role !== "student") throw Error("학생 계정으로 로그인하세요.");
    if ((form.room.value && profile.klass !== form.room.value) || (form.sid.value && profile.sid !== form.sid.value)) throw Error("등록한 학급과 학번을 확인하세요.");
    await ready();
    form.reset(); form.hidden=true; document.querySelector("#app").hidden=false;
  }
  const checked = result => { if(result.error) throw result.error; return result.data; };
  form.onsubmit = async event => {
    event.preventDefault();
    const mode=event.submitter?.value, button=event.submitter;
    if(button) button.disabled=true;
    try {
      const email=form.email.value.trim(), password=form.password.value;
      if (mode==="reset") {
        if(!email || !form.email.reportValidity()) throw Error("가입 이메일을 입력하세요.");
        checked(await client.auth.resetPasswordForEmail(email,{redirectTo}));
        message.textContent="가입 이메일의 재설정 링크를 여세요."; return;
      }
      if (mode==="signup") {
        if(!await rpc("open_room",{room:form.room.value})) throw Error("교사가 발급한 학급 코드를 확인하세요.");
        if(!form.displayName.value.trim()) throw Error("이름을 입력하세요.");
        const data=checked(await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo,data:{room:form.room.value,sid:form.sid.value,display_name:form.displayName.value.trim()}}}));
        if (!data.session) {message.textContent="이메일 인증 후 같은 학급 코드와 학번으로 로그인하세요.";return;}
      } else checked(await client.auth.signInWithPassword({email,password}));
      await enter();
    } catch(error){reportError(error);} finally {if(button) button.disabled=false;}
  };
  const recovery=document.querySelector("#recovery");
  recovery.onsubmit=async event=>{
    event.preventDefault();
    try {checked(await client.auth.updateUser({password:recovery.newPassword.value})); await client.auth.signOut({scope:"local"}); location.replace(redirectTo);}
    catch(error){recovery.querySelector("output").textContent=error.message;}
  };
  client.auth.onAuthStateChange((event,session)=>{
    if(event==="PASSWORD_RECOVERY") sessionStorage.setItem("class-recovery","1");
    if (!session || !["INITIAL_SESSION","PASSWORD_RECOVERY","SIGNED_IN"].includes(event)) return;
    if(sessionStorage.getItem("class-recovery")) {form.hidden=true; recovery.hidden=false;}
  });
  recovery.addEventListener("submit",()=>sessionStorage.removeItem("class-recovery"));
  if(isAuthCallback) {
    client.auth.getSession().then(async result=>{
      if(result.error) throw result.error;
      await new Promise(resolve=>setTimeout(resolve,100));
      if (!recovery.hidden) return;
      if(result.data.session) await enter();
    }).catch(reportError);
  }
  document.querySelector("#logout").onclick=async()=>{await client.auth.signOut({scope:"local"});location.replace(redirectTo);};
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

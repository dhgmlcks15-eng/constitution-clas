let accessToken;
let profile;
let accountId;
async function api(path, body) {
  const {url, publishableKey} = classroomConfig;
  if (!url || !publishableKey) throw Error("관리자가 config.js에 Supabase 프로젝트를 연결해야 합니다.");
  const headers = {"Content-Type":"application/json", apikey:publishableKey};
  if (accessToken) headers.Authorization = "Bearer " + accessToken;
  const response = await fetch(url.replace(/\/$/,"") + path, {method:"POST", headers, body:JSON.stringify(body)});
  if (!response.ok) {
    if (response.status === 401) throw Error("인증 시간이 만료되었습니다. 새로고침한 뒤 다시 로그인하세요.");
    const detail = await response.json().catch(() => ({}));
    throw Error(detail.message || "계정과 입력 내용을 확인하세요.");
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name,args={}) => api("/rest/v1/rpc/classroom_" + name,args);
function login(role, ready) {
  const form = document.querySelector("#login");
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const session = await api("/auth/v1/token?grant_type=password",{email:form.email.value.trim(),password:form.password.value});
      accessToken = session.access_token;
      accountId = session.user.id;
      profile = await rpc("profile");
      if (profile?.role !== role || (role === "student" && (profile.sid !== form.sid.value || profile.klass !== form.room.value))) throw Error("등록된 계정·학급·학번을 확인하세요.");
      await ready();
      form.reset();
      form.hidden = true;
      document.querySelector("#app").hidden = false;
    } catch (error) {
      accessToken = null;
      form.querySelector("output").textContent = error.message;
    } finally { button.disabled = false; }
  };
  document.querySelector("#logout").onclick = () => location.reload();
}

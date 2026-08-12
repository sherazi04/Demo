#!/usr/bin/env bash
# Signs in as each demo account and checks every page it can reach renders
# with content rather than an empty state.
set -u
BASE=http://localhost:3000

login() {
  local email=$1 password=$2 jar=$3
  rm -f "$jar"
  local token
  token=$(curl -s -c "$jar" -b "$jar" "$BASE/api/auth/csrf" | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/auth/callback/credentials" \
    -H "content-type: application/x-www-form-urlencoded" \
    --data "csrfToken=$token&email=$email&password=$password&json=true" >/dev/null
  curl -s -b "$jar" "$BASE/api/auth/session" | grep -o '"role":"[a-z]*"' || echo "NO SESSION"
}

page() {
  local jar=$1 path=$2 marker=$3
  local body code
  body=$(curl -s -b "$jar" -w "\n%{http_code}" "$BASE$path")
  code=$(echo "$body" | tail -1)
  if [ "$code" != "200" ]; then
    printf "  %-26s %s\n" "$path" "HTTP $code"
    return
  fi
  if echo "$body" | grep -qi "$marker"; then
    printf "  %-26s 200  contains %s\n" "$path" "\"$marker\""
  else
    printf "  %-26s 200  MISSING \"%s\"\n" "$path" "$marker"
  fi
}

echo
echo "TEACHER  teacher@example.edu"
login teacher@example.edu 'DemoPass!2025' /tmp/t.jar
page /tmp/t.jar /teacher            "CS-201"
page /tmp/t.jar /teacher/materials  "course notes"
page /tmp/t.jar /teacher/bank       "Bloom"
page /tmp/t.jar /teacher/curriculum "CLO"
page /tmp/t.jar /teacher/analytics  "mastery"
page /tmp/t.jar /teacher/tags       "review"
page /tmp/t.jar /teacher/feedback   "feedback"

echo
echo "STUDENT  student@example.edu"
login student@example.edu 'DemoPass!2025' /tmp/s.jar
page /tmp/s.jar /student            "mastery"
page /tmp/s.jar /student/progress   "outcome"
page /tmp/s.jar /student/plan       "learning path"
page /tmp/s.jar /student/resources  "Study material"
page /tmp/s.jar /student/quiz       "Practice"

echo
echo "ADMIN    admin@example.edu"
login admin@example.edu 'ChangeMe!2025' /tmp/a.jar
page /tmp/a.jar /admin              "status"
page /tmp/a.jar /admin/users        "example.edu"
page /tmp/a.jar /admin/audit        "chain"
page /tmp/a.jar /admin/bias         "slice"
page /tmp/a.jar /admin/validation   "check"
page /tmp/a.jar /admin/settings     "retrieval"
page /tmp/a.jar /admin/enrolment    "CS-201"
echo

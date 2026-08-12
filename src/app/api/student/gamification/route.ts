import { currentStudentCourse } from "@/student/context";
import {
  getLeaderboard,
  getStreak,
  listBadges,
  pointsBalance,
} from "@/student/gamification";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const { actor } = await currentStudentCourse();

  const [points, badges, streak, leaderboard] = await Promise.all([
    pointsBalance(actor.id),
    listBadges(actor.id),
    getStreak(actor.id),
    getLeaderboard(actor.id),
  ]);

  return json({
    points,
    badges,
    streak,
    // null means this student has not opted in — they neither appear on the
    // board nor can see it (FR-STU-053).
    leaderboard,
    leaderboardOptedIn: leaderboard !== null,
  });
});

export async function publishCarousel({ repos, userId, carouselId, platforms, caption, config }) {
  const carousel = repos.carousels.findOwned(userId, carouselId);
  if (!carousel) {
    const error = new Error("Carousel not found for this user.");
    error.status = 404;
    throw error;
  }
  const results = {};
  for (const platform of platforms) {
    const connection = repos.socialConnections.find(userId, platform);
    if (!connection) {
      results[platform] = { ok: false, status: 503, message: `${platform} is not connected or OAuth is not configured.` };
      continue;
    }
    if (platform === "instagram" && !config.instagram.clientId) {
      results[platform] = { ok: false, status: 503, message: "Instagram publishing credentials are not configured." };
      continue;
    }
    if (platform === "linkedin" && !config.linkedin.clientId) {
      results[platform] = { ok: false, status: 503, message: "LinkedIn publishing credentials are not configured." };
      continue;
    }
    results[platform] = { ok: false, status: 501, message: `Live ${platform} publish adapter is configured but network publish is disabled in this local build.`, caption };
  }
  return results;
}

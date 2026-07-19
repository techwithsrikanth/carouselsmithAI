export function linkedinAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile w_member_social",
    state
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export function linkedinPostBody({ authorUrn, imageUrns, caption }) {
  return {
    author: authorUrn,
    commentary: caption,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED" },
    content: { multiImage: { images: imageUrns.map((id) => ({ id })) } },
    lifecycleState: "PUBLISHED"
  };
}

export function instagramAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "instagram_basic,instagram_content_publish,pages_show_list,business_management",
    state
  });
  return `https://www.facebook.com/v20.0/dialog/oauth?${params}`;
}

export function instagramCarouselBody({ children, caption }) {
  return { media_type: "CAROUSEL", children: children.join(","), caption };
}

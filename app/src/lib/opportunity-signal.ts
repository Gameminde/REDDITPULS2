export interface OpportunitySourceCount {
    platform: string;
    count: number;
}

export interface OpportunityTopPost {
    title?: string;
    source?: string;
    subreddit?: string;
    score?: number;
    comments?: number;
    url?: string;
    source_class?: string;
    source_name?: string;
    voice_type?: string;
    signal_kind?: string;
    evidence_layer?: string;
    directness_tier?: string;
    reliability_tier?: string;
    market_support_level?: string;
}

export type OpportunitySupportLevel = "evidence_backed" | "supporting_context" | "hypothesis";

export interface OpportunitySignalContract {
    version: "v1";
    support_level: OpportunitySupportLevel;
    label: string;
    summary: string;
    buyer_native_direct_count: number;
    supporting_signal_count: number;
    launch_meta_count: number;
    single_source: boolean;
    hn_launch_heavy: boolean;
    dominant_platform: string | null;
    reasons: string[];
}

export function shouldSuppressOpportunityIdeaCard(input: {
    signalContract: OpportunitySignalContract;
    postCountTotal?: number | null;
}) {
    const signalContract = input.signalContract;
    const postCountTotal = Number(input.postCountTotal || 0);

    if (signalContract.support_level === "evidence_backed") {
        return false;
    }

    if (signalContract.buyer_native_direct_count > 0) {
        return false;
    }

    if (signalContract.hn_launch_heavy) {
        return true;
    }

    if (signalContract.support_level === "hypothesis" && signalContract.launch_meta_count >= 2 && postCountTotal < 20) {
        return true;
    }

    if (signalContract.support_level === "hypothesis" && signalContract.single_source && postCountTotal < 15) {
        return true;
    }

    if (signalContract.support_level === "hypothesis" && signalContract.supporting_signal_count <= 1 && postCountTotal < 15) {
        return true;
    }

    return false;
}

function normalizeText(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function getDominantPlatform(sources: OpportunitySourceCount[]) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    const top = [...sources].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
    return top ? String(top.platform || "").toLowerCase() || null : null;
}

export function isLaunchMetaOpportunityPost(post: OpportunityTopPost) {
    const title = normalizeText(post.title);
    const signalKind = normalizeText(post.signal_kind);
    const voiceType = normalizeText(post.voice_type);

    if (signalKind === "launch_discussion") return true;
    if (/^(show|launch|ask)\s+hn:/.test(title)) return true;
    if (/^(show|launch)\s+ih:/.test(title)) return true;
    if (/^(show|launch)\s+ph:/.test(title)) return true;
    if (voiceType === "founder" && /\bi built\b/.test(title)) return true;
    if ((voiceType === "founder" || voiceType === "developer") && /\bopen[- ]source\b/.test(title)) return true;
    return false;
}

export function isBuyerNativeOpportunityPost(post: OpportunityTopPost) {
    const voiceType = normalizeText(post.voice_type);
    const sourceClass = normalizeText(post.source_class);
    return voiceType === "buyer" || voiceType === "operator" || sourceClass === "review" || sourceClass === "jobs";
}

export function getOpportunityPostSupportLevel(post: OpportunityTopPost): OpportunitySupportLevel {
    const explicitLevel = normalizeText(post.market_support_level);
    const directness = normalizeText(post.directness_tier);
    const signalKind = normalizeText(post.signal_kind);
    const buyerNative = isBuyerNativeOpportunityPost(post);
    const launchMeta = isLaunchMetaOpportunityPost(post);

    if (explicitLevel === "evidence_backed" || explicitLevel === "supporting_context" || explicitLevel === "hypothesis") {
        return explicitLevel as OpportunitySupportLevel;
    }

    if (!launchMeta && buyerNative && directness === "direct") {
        return "evidence_backed";
    }

    if (!launchMeta && (
        directness === "adjacent"
        || (buyerNative && directness === "supporting")
        || signalKind === "complaint"
        || signalKind === "workaround"
        || signalKind === "feature_request"
        || signalKind === "review_complaint"
        || signalKind === "willingness_to_pay"
    )) {
        return "supporting_context";
    }

    return "hypothesis";
}

export function rankOpportunityRepresentativePosts(posts: OpportunityTopPost[]) {
    return [...(posts || [])].sort((left, right) => {
        const leftSupport = getOpportunityPostSupportLevel(left);
        const rightSupport = getOpportunityPostSupportLevel(right);
        const supportScore = {
            evidence_backed: 3,
            supporting_context: 2,
            hypothesis: 1,
        } as const;

        const leftBuyer = isBuyerNativeOpportunityPost(left) ? 1 : 0;
        const rightBuyer = isBuyerNativeOpportunityPost(right) ? 1 : 0;
        const leftLaunch = isLaunchMetaOpportunityPost(left) ? 1 : 0;
        const rightLaunch = isLaunchMetaOpportunityPost(right) ? 1 : 0;
        const leftScore = Number(left.score || 0) + Number(left.comments || 0);
        const rightScore = Number(right.score || 0) + Number(right.comments || 0);

        if (supportScore[leftSupport] !== supportScore[rightSupport]) {
            return supportScore[rightSupport] - supportScore[leftSupport];
        }
        if (leftBuyer !== rightBuyer) {
            return rightBuyer - leftBuyer;
        }
        if (leftLaunch !== rightLaunch) {
            return leftLaunch - rightLaunch;
        }
        return rightScore - leftScore;
    });
}

export function buildOpportunitySignalContract(input: {
    topPosts: OpportunityTopPost[];
    sources: OpportunitySourceCount[];
    sourceCount?: number | null;
}) : OpportunitySignalContract {
    const topPosts = Array.isArray(input.topPosts) ? input.topPosts : [];
    const sources = Array.isArray(input.sources) ? input.sources : [];
    const sourceCount = Number(input.sourceCount || sources.length || 0);

    const buyerNativeDirectCount = topPosts.filter((post) => getOpportunityPostSupportLevel(post) === "evidence_backed").length;
    const supportingSignalCount = topPosts.filter((post) => getOpportunityPostSupportLevel(post) === "supporting_context").length;
    const launchMetaCount = topPosts.filter(isLaunchMetaOpportunityPost).length;
    const singleSource = sourceCount < 2;
    const dominantPlatform = getDominantPlatform(sources);
    const hnLaunchHeavy = dominantPlatform === "hackernews" && launchMetaCount >= 2 && buyerNativeDirectCount === 0;

    let supportLevel: OpportunitySupportLevel = "hypothesis";
    if ((buyerNativeDirectCount >= 2 && !singleSource) || buyerNativeDirectCount >= 3) {
        supportLevel = "evidence_backed";
    } else if (buyerNativeDirectCount >= 1 || supportingSignalCount >= 2) {
        supportLevel = "supporting_context";
    }

    if (hnLaunchHeavy) {
        supportLevel = "hypothesis";
    }

    const reasons: string[] = [];
    if (singleSource) reasons.push("Single-source signal");
    if (buyerNativeDirectCount === 0) reasons.push("No buyer-native direct proof attached yet");
    if (launchMetaCount > 0) reasons.push("Launch/meta posts are present in representative evidence");
    if (hnLaunchHeavy) reasons.push("Hacker News launch chatter is dominating this topic");

    let label = "Exploratory signal";
    let summary = "This topic is interesting, but the visible proof is still mostly contextual or inferred.";

    if (supportLevel === "evidence_backed") {
        label = "Buyer pain signal";
        summary = `Representative evidence includes ${buyerNativeDirectCount} buyer-native direct post${buyerNativeDirectCount === 1 ? "" : "s"}${singleSource ? ", but source diversity is still limited." : " across multiple supporting signals."}`;
    } else if (supportLevel === "supporting_context") {
        label = "Context signal";
        summary = buyerNativeDirectCount > 0
            ? `There is at least one direct buyer-native signal, but the case is still thin or concentrated.`
            : `Supporting evidence exists, but it is not yet strong enough to treat as validated demand.`;
    } else if (hnLaunchHeavy) {
        label = "Builder-launch heavy";
        summary = "Representative posts lean heavily on Hacker News launch/build chatter rather than buyer-native pain.";
    }

    return {
        version: "v1",
        support_level: supportLevel,
        label,
        summary,
        buyer_native_direct_count: buyerNativeDirectCount,
        supporting_signal_count: supportingSignalCount,
        launch_meta_count: launchMetaCount,
        single_source: singleSource,
        hn_launch_heavy: hnLaunchHeavy,
        dominant_platform: dominantPlatform,
        reasons,
    };
}





export const scrollToSection = (sectionName : string) => {
    const element = document.getElementById(sectionName);

    if(element){
        // Layout-based target (offsetTop chain) instead of
        // getBoundingClientRect()/scrollIntoView(): a cross-page landing can run
        // while app/template.tsx's route-enter scale transform is still animating,
        // and a rect-based target reads the transformed (shrunk) position, landing
        // short. offsetTop ignores ancestor transforms, so this lands correctly
        // regardless of when it runs.
        let top = 0;
        let node: HTMLElement | null = element;
        while (node) {
            top += node.offsetTop;
            node = node.offsetParent as HTMLElement | null;
        }
        const scrollMarginTop = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
        window.scrollTo({ top: top - scrollMarginTop, behavior: "smooth" });
    }
}
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Zap, Menu, X } from "lucide-react";

const navLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/pricing" },
  { label: "Support", href: "/support" },
];

export default function PublicNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  const handleNavClick = (href: string) => {
    setOpen(false);
    if (href.startsWith("/#")) {
      const anchor = href.substring(2);
      if (location === "/") {
        const element = document.getElementById(anchor);
        element?.scrollIntoView({ behavior: "smooth" });
      } else {
        window.location.href = href;
      }
    }
  };

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-nav-logo">
          <Zap className="h-6 w-6 text-primary" />
          <span className="text-xl font-display font-bold">FetchTheChange</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => {
                if (link.href.startsWith("/#")) {
                  e.preventDefault();
                  handleNavClick(link.href);
                }
              }}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              data-testid={`link-nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {link.label}
            </a>
          ))}
          <Button asChild data-testid="button-nav-signin">
            <a href="/api/login">Sign in</a>
          </Button>
        </div>

        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-nav-menu">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] sm:w-[320px]">
              <div className="flex flex-col gap-6 mt-8">
                <Link 
                  href="/" 
                  className="flex items-center gap-2" 
                  onClick={() => setOpen(false)}
                  data-testid="link-nav-logo-mobile"
                >
                  <Zap className="h-6 w-6 text-primary" />
                  <span className="text-xl font-display font-bold">FetchTheChange</span>
                </Link>
                
                <div className="flex flex-col gap-4">
                  {navLinks.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={(e) => {
                        if (link.href.startsWith("/#")) {
                          e.preventDefault();
                        }
                        handleNavClick(link.href);
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors text-base font-medium py-2"
                      data-testid={`link-nav-${link.label.toLowerCase().replace(/\s+/g, "-")}-mobile`}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
                
                <Button asChild className="mt-4" data-testid="button-nav-signin-mobile">
                  <a href="/api/login">Sign in</a>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
